import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";

import {
  createAwsConnectorKms,
  createLocalConnectorKms,
  decryptUtf8Envelope,
  encryptUtf8Envelope,
  isConnectorKmsEnvelope,
  parseConnectorKmsLocalKey,
  resolveConnectorKmsFromEnv,
  type ConnectorKmsSdk,
} from "../src/connector-kms.js";

describe("connector KMS envelope", () => {
  it("round-trips utf8 through a local data-key wrap", async () => {
    const kms = createLocalConnectorKms();
    const envelope = await encryptUtf8Envelope(kms, '{"oauth_refresh":"rtok"}');
    const parsed = JSON.parse(envelope) as Record<string, unknown>;
    expect(isConnectorKmsEnvelope(parsed)).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("rtok");
    const plain = await decryptUtf8Envelope(kms, envelope);
    expect(plain).toBe('{"oauth_refresh":"rtok"}');
  });

  it("fails decrypt with a different local master key", async () => {
    const a = createLocalConnectorKms("a".repeat(32));
    const b = createLocalConnectorKms("b".repeat(32));
    const envelope = await encryptUtf8Envelope(a, "secret-payload");
    await expect(decryptUtf8Envelope(b, envelope)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("parses 64-hex local keys", () => {
    const key = parseConnectorKmsLocalKey("ab".repeat(32));
    expect(key.length).toBe(32);
  });

  it("uses AWS KMS GenerateDataKey / Decrypt when a client is injected", async () => {
    const dataKey = Buffer.alloc(32, 7);
    const wrapped = Buffer.from("wrapped-data-key");
    const calls: string[] = [];
    const client: ConnectorKmsSdk = {
      async send(command) {
        if (command instanceof GenerateDataKeyCommand) {
          calls.push("generate");
          expect(command.input.KeyId).toBe("arn:aws:kms:us-east-1:1:key/abc");
          expect(command.input.KeySpec).toBe("AES_256");
          return {
            Plaintext: dataKey,
            CiphertextBlob: wrapped,
            KeyId: "arn:aws:kms:us-east-1:1:key/abc",
          };
        }
        if (command instanceof DecryptCommand) {
          calls.push("decrypt");
          expect(Buffer.from(command.input.CiphertextBlob ?? []).equals(wrapped)).toBe(
            true,
          );
          return { Plaintext: dataKey };
        }
        throw new Error("unexpected command");
      },
    };
    const kms = createAwsConnectorKms({
      keyId: "arn:aws:kms:us-east-1:1:key/abc",
      client,
    });
    const envelope = await encryptUtf8Envelope(kms, "hello-kms");
    expect(JSON.parse(envelope).ct).toBeTruthy();
    expect(JSON.stringify(envelope)).not.toContain("hello-kms");
    const plain = await decryptUtf8Envelope(kms, envelope);
    expect(plain).toBe("hello-kms");
    expect(calls).toEqual(["generate", "decrypt"]);
  });

  it("resolves env to local, aws, or none", () => {
    expect(resolveConnectorKmsFromEnv({}).kind).toBe("none");
    expect(
      resolveConnectorKmsFromEnv({ CONNECTOR_KMS_LOCAL_KEY: "c".repeat(32) }).kind,
    ).toBe("local");
    expect(
      resolveConnectorKmsFromEnv({ CONNECTOR_KMS_KEY_ID: "alias/connectors" }).kind,
    ).toBe("aws");
  });
});
