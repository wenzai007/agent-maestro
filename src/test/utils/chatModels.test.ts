import * as assert from "assert";
import * as vscode from "vscode";

import {
  chatModelsCache,
  getChatModelClient,
  getChatModelsQuickPickItems,
} from "../../utils/chatModels";

const model = (id: string, vendor = "copilot") =>
  ({
    id,
    name: id,
    family: id,
    vendor,
    version: id,
    maxInputTokens: 128000,
  }) as vscode.LanguageModelChat;

suite("Chat model discovery", () => {
  const lm = vscode.lm as {
    selectChatModels: typeof vscode.lm.selectChatModels;
  };
  const originalSelect = lm.selectChatModels;
  let originalModels: vscode.LanguageModelChat[];
  let available: vscode.LanguageModelChat[];
  let calls: number;

  setup(async () => {
    originalModels = chatModelsCache.getCachedModels();
    available = [model("claude-sonnet-4.6"), model("gpt-5.6-sol")];
    calls = 0;
    lm.selectChatModels = async () => {
      calls++;
      return [...available];
    };
    await chatModelsCache.refresh();
  });

  teardown(async () => {
    lm.selectChatModels = async () => originalModels;
    await chatModelsCache.refresh();
    lm.selectChatModels = originalSelect;
  });

  test("discovers a new exact model before fuzzy matching an older one", async () => {
    available.push(model("gpt-6.1-sol"));

    const result = await getChatModelClient("gpt-6.1-sol");

    assert.strictEqual(result.client?.id, "gpt-6.1-sol");
    assert.strictEqual(calls, 2);
  });

  test("keeps exact cached lookups inexpensive", async () => {
    await getChatModelClient("gpt-5.6-sol");
    await getChatModelClient("gpt-5.6-sol");
    assert.strictEqual(calls, 1);
  });

  test("refreshes additions and removals after provider invalidation", async () => {
    available = [model("gpt-6.1-sol")];
    chatModelsCache.invalidate();

    const models = await chatModelsCache.getChatModels();

    assert.deepStrictEqual(
      models.map((m) => m.id),
      ["gpt-6.1-sol"],
    );
    assert.strictEqual(calls, 2);
  });

  test("refreshes model pickers while excluding other vendors", async () => {
    available.push(
      model("gpt-6.1-sol"),
      model("gemini-other-provider", "copilotcli"),
    );

    const items = await getChatModelsQuickPickItems();

    assert.ok(items.some((item) => item.modelId === "gpt-6.1-sol"));
    assert.ok(!items.some((item) => item.modelId === "gemini-other-provider"));
  });

  test("shares concurrent refreshes and waits for the current catalog", async () => {
    let resolve!: (models: vscode.LanguageModelChat[]) => void;
    lm.selectChatModels = () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    };

    const first = chatModelsCache.refresh();
    const second = chatModelsCache.refresh();
    const lookup = chatModelsCache.getChatModels();
    assert.strictEqual(calls, 2);
    resolve([model("gpt-6.1-sol")]);
    await Promise.all([first, second]);
    assert.deepStrictEqual(
      (await lookup).map((m) => m.id),
      ["gpt-6.1-sol"],
    );
  });

  test("does not lose a provider change while discovery is in flight", async () => {
    let resolve!: (models: vscode.LanguageModelChat[]) => void;
    lm.selectChatModels = () =>
      new Promise((done) => {
        resolve = done;
      });
    const refresh = chatModelsCache.refresh();
    chatModelsCache.invalidate();
    lm.selectChatModels = async () => [model("gpt-6.1-sol")];
    resolve([model("gpt-5.6-sol")]);

    await refresh;

    assert.deepStrictEqual(
      chatModelsCache.getCachedModels().map((m) => m.id),
      ["gpt-6.1-sol"],
    );
  });

  test("preserves the last catalog on failure and retries on the next lookup", async () => {
    lm.selectChatModels = async () => {
      throw new Error("Provider temporarily unavailable");
    };
    await chatModelsCache.refresh();
    assert.ok(
      chatModelsCache.getCachedModels().some((m) => m.id === "gpt-5.6-sol"),
    );

    lm.selectChatModels = async () => [model("gpt-6.1-sol")];
    const result = await getChatModelClient("gpt-6.1-sol");
    assert.strictEqual(result.client?.id, "gpt-6.1-sol");
  });

  test("retains fuzzy matching after checking the current catalog", async () => {
    const result = await getChatModelClient("GPT 5.6 Sol");
    assert.strictEqual(result.client?.id, "gpt-5.6-sol");
    assert.strictEqual(calls, 2);
  });
});
