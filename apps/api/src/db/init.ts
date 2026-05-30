import { createApiConfig } from "../config";
import { SqliteTradingStore } from "../../../../packages/trading/src/sqliteStore";

const config = await createApiConfig();
const store = new SqliteTradingStore(config.databaseUrl);
store.init();
console.log(`Initialized SQLite database at ${config.databaseUrl}`);
