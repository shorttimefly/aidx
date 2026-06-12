const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

const localStore = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  window: {
    location: { pathname: "/" },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    dispatchEvent() {}
  },
  document: {
    addEventListener() {},
    body: { dataset: {}, append() {} },
    createElement() {
      return { dataset: {}, value: "", textContent: "", remove() {}, click() {} };
    },
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  },
  localStorage: {
    setItem(key, value) {
      localStore.set(key, String(value));
    },
    getItem(key) {
      return localStore.has(key) ? localStore.get(key) : "";
    },
    removeItem(key) {
      localStore.delete(key);
    }
  },
  indexedDB: {},
  navigator: {},
  URL: { createObjectURL() { return "blob:mock"; }, revokeObjectURL() {} },
  Blob,
  Image: function Image() {},
  FileReader: function FileReader() {}
};

vm.createContext(context);
vm.runInContext(appSource, context, { filename: "app.js" });

function createSelect() {
  return { value: "", innerHTML: "" };
}

vm.runInContext(
  `
    Object.assign(els, {
      platformSelect: __platformSelect,
      categorySelect: __categorySelect,
      scenarioSelect: __scenarioSelect,
      templateSelectionHint: __templateSelectionHint,
      countInput: { value: "1" },
      sizeInput: { value: "1024x1024" },
      generateBtn: {},
      resultGrid: { className: "", innerHTML: "" }
    });
    state.promptConfig = buildRuntimePromptConfig();
    state.singleSelectionMemoryByLeaf = {};
    renderTemplateFilterOptions();
    renderTemplates();
  `,
  Object.assign(context, {
    __platformSelect: createSelect(),
    __categorySelect: createSelect(),
    __scenarioSelect: createSelect(),
    __templateSelectionHint: { innerHTML: "" }
  })
);

assert.equal(vm.runInContext("state.selectedPlatformId", context), "amazon-aplus");
assert.equal(vm.runInContext("state.selectedCategoryId", context), "3c-digital-accessories");
assert.equal(vm.runInContext("state.selectedScenarioId", context), "brand-story");
assert.equal(vm.runInContext("state.selectedTemplateId", context), "amazon-aplus-3c-digital-accessories-brand-story");

vm.runInContext(
  `
    state.singleSelectionMemoryByLeaf = { "amazon-aplus::3c-digital-accessories": "lifestyle-module" };
    state.selectedPlatformId = "amazon-aplus";
    state.selectedCategoryId = "3c-digital-accessories";
    state.selectedScenarioId = "";
    renderTemplateFilterOptions();
  `,
  context
);
assert.equal(vm.runInContext("state.selectedScenarioId", context), "lifestyle-module");

vm.runInContext(
  `
    state.singleSelectionMemoryByLeaf = { "amazon-aplus::3c-digital-accessories": "missing-scene" };
    state.selectedPlatformId = "amazon-aplus";
    state.selectedCategoryId = "3c-digital-accessories";
    state.selectedScenarioId = "";
    renderTemplateFilterOptions();
  `,
  context
);
assert.equal(vm.runInContext("state.selectedScenarioId", context), "brand-story");

(async () => {
  const result = await vm.runInContext(
    `
      (async () => {
        let requested = 0;
        let toasted = "";
        ensureApiReady = async () => true;
        requestImagesExact = async () => {
          requested += 1;
          return { images: [], calls: 0 };
        };
        showToast = (message) => {
          toasted = message;
        };
        state.selectedPlatformId = "amazon-aplus";
        state.selectedCategoryId = "3c-digital-accessories";
        state.selectedScenarioId = "brand-story";
        state.selectedTemplateId = "stale-template-id";
        await handleGenerate();
        return { requested, toasted };
      })()
    `,
    context
  );
  assert.equal(result.requested, 0);
  assert.ok(result.toasted);
  console.log("single template selection tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
