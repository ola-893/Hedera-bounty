/* contractFunctionParameterBuilder.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ContractFunctionParameters } from "@hashgraph/sdk";

export interface ContractFunctionParameterBuilderParam {
  type: string;
  name: string;
  value: any;
}

export class ContractFunctionParameterBuilder {
  private params: ContractFunctionParameterBuilderParam[] = [];

  public addParam(
    param: ContractFunctionParameterBuilderParam
  ): ContractFunctionParameterBuilder {
    this.params.push(param);
    return this;
  }

  public buildAbiFunctionParams(): string {
    return this.params.map((param) => `${param.type} ${param.name}`).join(", ");
  }

  public buildEthersParams(): string[] {
    return this.params.map((param) => param.value.toString());
  }

  public buildHAPIParams(): ContractFunctionParameters {
    const contractFunctionParams = new ContractFunctionParameters();

    for (const param of this.params) {
      const type = param.type.trim();

      // ——— Special: tuple and tuple[] ———
      if (type === "tuple" || type === "tuple[]") {
        console.log(`Encoding ${type}:`, param.value);
        const jsonString = JSON.stringify(param.value);
        const encoder = new TextEncoder();
        const bytes = encoder.encode(jsonString);
        contractFunctionParams.addBytes(bytes);
        continue;
      }

      // ——— Special: int64 ———
      if (type === "int64") {
        let int64Value = param.value;
        if (typeof param.value === "bigint") {
          const MAX_INT64 = BigInt("9223372036854775807");
          const MIN_INT64 = BigInt("-9223372036854775808");
          if (param.value > MAX_INT64 || param.value < MIN_INT64) {
            throw new Error(
              `int64 value ${param.value} is outside safe int64 range`
            );
          }
          int64Value = Number(param.value);
        }
        contractFunctionParams.addInt64(int64Value);
        continue;
      }

      // ——— Handle arrays: uint256[], address[], etc. ———
      const isArray = type.endsWith("[]");
      const baseType = isArray ? type.slice(0, -2) : type;

      // Validate base type is alphanumeric
      const alphanumericIdentifier: RegExp = /^[a-zA-Z][a-zA-Z0-9]*$/;
      if (!baseType.match(alphanumericIdentifier)) {
        throw new Error(
          `Invalid base type: ${baseType}. Must be alphanumeric (e.g. uint256, address).`
        );
      }

      const functionName = `add${
        baseType.charAt(0).toUpperCase() + baseType.slice(1)
      }`;

      if (!(functionName in contractFunctionParams)) {
        throw new Error(
          `Unsupported type: ${baseType}. No method ${functionName} in ContractFunctionParameters.`
        );
      }

      if (isArray) {
        if (!Array.isArray(param.value)) {
          throw new Error(
            `Expected array for type ${type}, got ${typeof param.value}`
          );
        }
        for (const item of param.value) {
          (contractFunctionParams as any)[functionName](item);
        }
      } else {
        (contractFunctionParams as any)[functionName](param.value);
      }
    }

    return contractFunctionParams;
  }
}
