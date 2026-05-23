import path from "node:path";
import fs from "fs-extra";

export interface CoolifyApplicationRecord {
  uuid?: string;
  tag?: string;
  force?: boolean;
}

export interface CoolifyAppsConfig {
  schemaVersion: "1.0";
  applications: Record<string, CoolifyApplicationRecord>;
}

export interface CoolifyApplicationSummary {
  uuid: string;
  name: string;
  git_commit_sha?: string;
  status?: string;
  fqdn?: string;
}

export interface CoolifyApplicationDetail extends CoolifyApplicationSummary {
  fqdn?: string;
  health_check_path?: string;
  health_check_enabled?: boolean;
}

export interface CoolifyProjectSummary {
  uuid: string;
  name?: string;
}

export interface CoolifyServerSummary {
  uuid: string;
  name?: string;
}

export interface CoolifyDeployResult {
  deploymentId: string;
  resourceUuid?: string;
  message: string;
  revision?: string;
}

export interface CoolifyRollbackResult {
  rollbackId: string;
  mode: "restart" | "redeploy";
  message: string;
}

export interface CoolifyClientConfig {
  origin: string;
  apiToken: string;
  appsConfigPath?: string;
  fetchImpl?: typeof fetch;
}

function normalizeOrigin(origin: string): string {
  const trimmed = origin.replace(/\/$/, "");
  if (trimmed.endsWith("/api/v1")) {
    return trimmed;
  }
  return `${trimmed}/api/v1`;
}

export async function loadCoolifyAppsConfig(configPath: string): Promise<CoolifyAppsConfig | null> {
  if (!(await fs.pathExists(configPath))) {
    return null;
  }
  return (await fs.readJson(configPath)) as CoolifyAppsConfig;
}

export function defaultCoolifyAppsConfigPath(rootDir: string): string {
  return path.join(rootDir, "infra", "coolify", "apps.json");
}

export class CoolifyClient {
  private readonly apiBase: string;
  private readonly apiToken: string;
  private readonly appsConfigPath?: string;
  private readonly fetchImpl: typeof fetch;
  private appsConfigCache: CoolifyAppsConfig | null | undefined;

  constructor(config: CoolifyClientConfig) {
    if (!config.origin.trim() || !config.apiToken.trim()) {
      throw new Error("Coolify client requires origin and apiToken.");
    }
    this.apiBase = normalizeOrigin(config.origin);
    this.apiToken = config.apiToken;
    this.appsConfigPath = config.appsConfigPath;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const url = `${this.apiBase}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiToken}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = { message: text };
      }
    }
    if (!response.ok) {
      const message =
        typeof payload === "object" && payload && "message" in payload
          ? String((payload as { message: unknown }).message)
          : `Coolify API ${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return payload as T;
  }

  async listApplications(): Promise<CoolifyApplicationSummary[]> {
    const payload = await this.request<CoolifyApplicationSummary[] | { data?: CoolifyApplicationSummary[] }>(
      "/applications",
    );
    if (Array.isArray(payload)) {
      return payload;
    }
    return payload.data ?? [];
  }

  async getApplication(uuid: string): Promise<CoolifyApplicationDetail> {
    return this.request<CoolifyApplicationDetail>(`/applications/${uuid}`);
  }

  async findApplicationByName(appName: string, rootDir?: string): Promise<CoolifyApplicationDetail | null> {
    try {
      const target = await this.resolveApplication(appName, rootDir);
      if (!target.uuid) {
        return null;
      }
      return this.getApplication(target.uuid);
    } catch {
      return null;
    }
  }

  async listProjects(): Promise<CoolifyProjectSummary[]> {
    const payload = await this.request<CoolifyProjectSummary[] | { data?: CoolifyProjectSummary[] }>("/projects");
    return Array.isArray(payload) ? payload : (payload.data ?? []);
  }

  async listServers(): Promise<CoolifyServerSummary[]> {
    const payload = await this.request<CoolifyServerSummary[] | { data?: CoolifyServerSummary[] }>("/servers");
    return Array.isArray(payload) ? payload : (payload.data ?? []);
  }

  private async resolveDefaultProjectUuid(explicit?: string): Promise<string> {
    if (explicit) {
      return explicit;
    }
    const projects = await this.listProjects();
    const first = projects[0];
    if (!first?.uuid) {
      throw new Error("Coolify has no projects. Create a project in the panel or set DEXTER_COOLIFY_PROJECT_UUID.");
    }
    return first.uuid;
  }

  private async resolveDefaultServerUuid(explicit?: string): Promise<string> {
    if (explicit) {
      return explicit;
    }
    const servers = await this.listServers();
    const localhost = servers.find((server) => server.name?.toLowerCase().includes("localhost"));
    const pick = localhost ?? servers[0];
    if (!pick?.uuid) {
      throw new Error("Coolify has no servers. Set DEXTER_COOLIFY_SERVER_UUID.");
    }
    return pick.uuid;
  }

  async updateApplicationDockerImage(
    appName: string,
    input: { image: string; tag: string; rootDir?: string },
  ): Promise<CoolifyApplicationDetail> {
    const target = await this.resolveApplication(appName, input.rootDir);
    if (!target.uuid) {
      throw new Error(`Cannot update image for appName=${appName}: missing uuid`);
    }
    return this.request<CoolifyApplicationDetail>(`/applications/${target.uuid}`, {
      method: "PATCH",
      body: JSON.stringify({
        docker_registry_image_name: input.image,
        docker_registry_image_tag: input.tag,
      }),
    });
  }

  async createDockerImageApplication(input: {
    name: string;
    dockerImage: string;
    dockerTag?: string;
    portsExposes: string;
    projectUuid?: string;
    serverUuid?: string;
    environmentName: string;
    environmentUuid?: string;
    instantDeploy?: boolean;
  }): Promise<CoolifyApplicationDetail> {
    const projectUuid = await this.resolveDefaultProjectUuid(input.projectUuid);
    const serverUuid = await this.resolveDefaultServerUuid(input.serverUuid);
    const body: Record<string, unknown> = {
      project_uuid: projectUuid,
      server_uuid: serverUuid,
      environment_name: input.environmentName,
      environment_uuid: input.environmentUuid ?? projectUuid,
      docker_registry_image_name: input.dockerImage,
      docker_registry_image_tag: input.dockerTag ?? "latest",
      ports_exposes: input.portsExposes,
      name: input.name,
      instant_deploy: input.instantDeploy ?? false,
    };
    return this.request<CoolifyApplicationDetail>("/applications/dockerimage", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async loadAppsConfig(rootDir?: string): Promise<CoolifyAppsConfig | null> {
    if (this.appsConfigCache !== undefined) {
      return this.appsConfigCache;
    }
    const configPath =
      this.appsConfigPath ?? (rootDir ? defaultCoolifyAppsConfigPath(rootDir) : defaultCoolifyAppsConfigPath(process.cwd()));
    this.appsConfigCache = await loadCoolifyAppsConfig(configPath);
    return this.appsConfigCache;
  }

  async resolveApplication(
    appName: string,
    rootDir?: string,
  ): Promise<{ uuid?: string; tag?: string; force?: boolean }> {
    const config = await this.loadAppsConfig(rootDir);
    const configured = config?.applications[appName];
    if (configured?.uuid || configured?.tag) {
      return configured;
    }

    const applications = await this.listApplications();
    const match = applications.find((app) => app.name === appName);
    if (!match) {
      throw new Error(`Coolify application not found for appName=${appName}. Add infra/coolify/apps.json or create the app in Coolify.`);
    }
    return { uuid: match.uuid, force: configured?.force };
  }

  async deployApplication(
    appName: string,
    options?: {
      rootDir?: string;
      force?: boolean;
      deployTag?: string;
      syncManifestImage?: { image: string; tag: string };
    },
  ): Promise<CoolifyDeployResult> {
    if (options?.syncManifestImage) {
      await this.updateApplicationDockerImage(appName, {
        image: options.syncManifestImage.image,
        tag: options.syncManifestImage.tag,
        rootDir: options.rootDir,
      });
    }

    const target = await this.resolveApplication(appName, options?.rootDir);
    const force = options?.force ?? target.force ?? false;
    const deployTag = options?.deployTag ?? target.tag;

    if (deployTag) {
      const query = new URLSearchParams({ tag: deployTag, force: String(force) });
      const payload = await this.request<{
        deployments?: Array<{ deployment_uuid?: string; resource_uuid?: string; message?: string }>;
        message?: string;
      }>(`/deploy?${query.toString()}`, { method: "GET" });
      const first = payload.deployments?.[0];
      if (!first?.deployment_uuid) {
        throw new Error(payload.message ?? `Coolify deploy by tag failed for tag=${deployTag}`);
      }
      return {
        deploymentId: first.deployment_uuid,
        resourceUuid: first.resource_uuid,
        message: first.message ?? "deploy queued",
      };
    }

    if (!target.uuid) {
      throw new Error(`No Coolify uuid or tag configured for appName=${appName}`);
    }

    const payload = await this.request<{
      deployments?: Array<{ deployment_uuid?: string; resource_uuid?: string; message?: string }>;
      message?: string;
    }>("/deploy", {
      method: "POST",
      body: JSON.stringify({ uuid: target.uuid, force }),
    });
    const first = payload.deployments?.[0];
    if (!first?.deployment_uuid) {
      throw new Error(payload.message ?? `Coolify deploy failed for uuid=${target.uuid}`);
    }
    return {
      deploymentId: first.deployment_uuid,
      resourceUuid: first.resource_uuid ?? target.uuid,
      message: first.message ?? "deploy queued",
      revision: target.uuid,
    };
  }

  /**
   * Coolify's public API does not expose git rollback directly. Restart returns the last
   * running container; use redeploy mode when a new deployment must be triggered.
   */
  async rollbackApplication(
    appName: string,
    options?: { rootDir?: string; mode?: "restart" | "redeploy" },
  ): Promise<CoolifyRollbackResult> {
    const mode = options?.mode ?? "restart";
    const target = await this.resolveApplication(appName, options?.rootDir);
    if (!target.uuid) {
      throw new Error(`Rollback requires application uuid for appName=${appName}`);
    }

    if (mode === "redeploy") {
      const deploy = await this.deployApplication(appName, { rootDir: options?.rootDir, force: false });
      return {
        rollbackId: deploy.deploymentId,
        mode: "redeploy",
        message: deploy.message,
      };
    }

    const payload = await this.request<{ message?: string; deployment_uuid?: string }>(
      `/applications/${target.uuid}/restart`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return {
      rollbackId: payload.deployment_uuid ?? `restart-${target.uuid}-${Date.now()}`,
      mode: "restart",
      message: payload.message ?? `Restart queued for ${appName}`,
    };
  }
}

export function createCoolifyClientFromEnv(rootDir?: string): CoolifyClient | null {
  const origin = process.env.COOLIFY_ORIGIN ?? process.env.DEXTER_COOLIFY_ORIGIN;
  const apiToken = process.env.COOLIFY_API_TOKEN ?? process.env.DEXTER_COOLIFY_API_TOKEN;
  if (!origin || !apiToken) {
    return null;
  }
  const appsConfigPath =
    process.env.COOLIFY_APPS_CONFIG ?? (rootDir ? defaultCoolifyAppsConfigPath(rootDir) : undefined);
  return new CoolifyClient({ origin, apiToken, appsConfigPath });
}
