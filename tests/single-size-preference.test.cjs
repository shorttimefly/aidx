const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

assert.ok(appSource.includes("state.userSelectedSingleSize = true"));

function createSelect(initialValue) {
  const select = {
    value: initialValue,
    options: [{ value: initialValue, textContent: initialValue }],
    prepend(option) {
      this.options.unshift(option);
    },
    insertBefore(option) {
      this.options.unshift(option);
    }
  };
  return select;
}

const context = {
  console,
  setTimeout,
  window: {
    location: { pathname: "/" },
    setTimeout,
    addEventListener() {},
    dispatchEvent() {}
  },
  document: {
    addEventListener() {},
    body: { dataset: {} },
    createElement() {
      return { dataset: {}, value: "", textContent: "" };
    },
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  },
  localStorage: {
    setItem() {},
    getItem() {
      return "";
    },
    removeItem() {}
  },
  indexedDB: {},
  navigator: {},
  Image: function Image() {},
  FileReader: function FileReader() {}
};

vm.createContext(context);
vm.runInContext(appSource, context, { filename: "app.js" });

const selectedSize = "1024x1024";
const detectedSize = "1600x1600";
const result = vm.runInContext(
  `
    Object.assign(els, { sizeInput: __sizeInput, suiteSizeInput: null });
    state.userSelectedSingleSize = true;
    applyDetectedSize("${detectedSize}");
    els.sizeInput.value;
  `,
  Object.assign(context, { __sizeInput: createSelect(selectedSize) })
);

assert.equal(result, selectedSize);

const autoResult = vm.runInContext(
  `
    Object.assign(els, { sizeInput: __autoSizeInput, suiteSizeInput: null });
    state.userSelectedSingleSize = false;
    applyDetectedSize("${detectedSize}");
    els.sizeInput.value;
  `,
  Object.assign(context, { __autoSizeInput: createSelect(selectedSize) })
);

assert.equal(autoResult, detectedSize);

console.log("single size preference tests passed");
