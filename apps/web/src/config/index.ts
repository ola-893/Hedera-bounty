import { networkConfig } from "./networks";
import type { AppConfig } from "./type";
import * as constants from "./constants";

export * from "./type";

export const appConfig: AppConfig & {
  constants: typeof constants;
} = {
  networks: networkConfig,
  constants,
};
