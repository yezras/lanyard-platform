/**
 * LiteLLM config written from Settings.
 * Saved vault keys are inlined. Environment keys stay `os.environ/NAME`.
 * The file mode is 0600 and it is not part of git.
 */

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadModelCatalog } from "./model-catalog.js";
import { providerKeyYamlScalar } from "./provider-keys.js";

export function litellmGeneratedConfigPath(root: string): string {
  return path.join(root, "admin", "litellm.generated.yaml");
}

export async function materializeLiteLLMConfig(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const catalog = await loadModelCatalog(root);
  const lines: string[] = [
    "# Written by Portal Settings. Local stand-in for encrypted cloud storage.",
    "# Do not commit this file.",
  ];
  const modelLines: string[] = [];

  for (const model of catalog.models) {
    if (!model.enabled || !model.litellm_model || !model.key_id) continue;
    const apiKey = await providerKeyYamlScalar(root, model.key_id, env);
    if (!apiKey) continue;
    modelLines.push(
      `  - model_name: ${JSON.stringify(model.litellm_model)}`,
      "    litellm_params:",
      `      model: ${JSON.stringify(model.litellm_model)}`,
      `      api_key: ${apiKey}`,
    );
  }

  lines.push(modelLines.length === 0 ? "model_list: []" : "model_list:", ...modelLines);

  const file = litellmGeneratedConfigPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path.dirname(file), 0o700);
  await chmod(file, 0o600);
}
