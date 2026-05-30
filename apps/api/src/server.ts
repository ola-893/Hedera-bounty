import { buildApp } from "./app";
import { createApiConfig } from "./config";

const config = await createApiConfig();
const app = await buildApp({ config });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
