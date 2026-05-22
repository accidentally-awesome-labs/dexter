import dotenv from "dotenv";
import { startCoolifyBridgeServer } from "../providers/deployment/coolify-bridge-server.js";

dotenv.config();

const server = startCoolifyBridgeServer();
server.on("listening", () => {
  const address = server.address();
  if (address && typeof address !== "string") {
    console.log(
      JSON.stringify(
        {
          status: "listening",
          url: `http://${process.env.DEXTER_BRIDGE_HOST ?? "127.0.0.1"}:${address.port}`,
          dexterEnv: {
            DEXTER_COOLIFY_API_URL: `http://${process.env.DEXTER_BRIDGE_HOST ?? "127.0.0.1"}:${address.port}`,
            DEXTER_COOLIFY_TOKEN: process.env.DEXTER_BRIDGE_TOKEN ? "<set>" : "<missing>",
          },
        },
        null,
        2,
      ),
    );
  }
});
