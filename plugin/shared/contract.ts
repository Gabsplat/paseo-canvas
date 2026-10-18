import type { ZodType, input as ZodInput, output as ZodOutput } from 'zod';

// The RPC and settings contract shapes Lienzo shares with every host. They are structurally the same as the
// Paseo plugin SDK's (`defineRpc`, `defineSettings`), so a Paseo host takes them unchanged, and they need no SDK.

export interface RpcContract<InputSchema extends ZodType = ZodType, OutputSchema extends ZodType = ZodType> {
  name: string;
  input: InputSchema;
  output: OutputSchema;
}
export type RpcInput<Contract extends RpcContract> = ZodOutput<Contract['input']>;
export type RpcOutput<Contract extends RpcContract> = ZodInput<Contract['output']>;

const RPC_NAME = /^[a-z][a-z0-9._-]*$/;
export function defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(definition: RpcContract<InputSchema, OutputSchema>): RpcContract<InputSchema, OutputSchema> {
  const name = definition.name.trim();
  if (!RPC_NAME.test(name)) throw new Error(`Invalid RPC method: ${definition.name}`);
  return { ...definition, name };
}

export interface SettingsDefinition<Schema extends ZodType = ZodType> {
  id: string;
  scope: 'host';
  version: number;
  schema: Schema;
  migrate?: (values: unknown, fromVersion: number) => unknown | Promise<unknown>;
}
export function defineSettings<Schema extends ZodType>(definition: SettingsDefinition<Schema>): SettingsDefinition<Schema> {
  if (!/^[a-z][a-z0-9_-]*$/.test(definition.id)) throw new Error('Invalid settings ID');
  if (definition.scope !== 'host') throw new Error('Only host-scoped settings are supported');
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) throw new Error('Invalid settings version');
  return definition;
}
