/**
 * Dependency-cruiser config for llm-feedback-middleware.
 *
 * Enforces architectural boundaries:
 * 1. No package may import any consumer-specific module (BEPA, Telegram, etc.)
 * 2. Adapter packages may not import each other (each adapter is independent)
 * 3. core/ must not import from any sibling package
 */
module.exports = {
  forbidden: [
    {
      name: "no-consumer-imports",
      severity: "error",
      comment:
        "Framework packages must never import from consumer-specific modules. " +
        "If you find yourself wanting to, the consumer should provide that data via the framework's ports instead.",
      from: { path: "^packages/" },
      to: {
        path: [
          "(^|/)bepa(/|$)",
          "(^|/)telegram(/|$)",
          "(^|/)outlook(/|$)",
          "(^|/)office(/|$)",
          "(^|/)companion(/|$)",
          "(^|/)graphiti(/|$)",
          "(^|/)temporal/(activities|workflows)(/|$)",
        ],
      },
    },
    {
      name: "core-no-sibling-imports",
      severity: "error",
      comment: "@ai-feedback-middleware/core must not import from any other package in the monorepo.",
      from: { path: "^packages/core/" },
      to: { path: "^packages/(?!core/)" },
    },
    {
      name: "adapter-no-cross-import",
      severity: "error",
      comment: "Adapter packages must not import each other. They are independent implementations.",
      from: { path: "^packages/(in-memory|postgres|redis-pubsub|kafka|nats|streams)/" },
      to: {
        path: "^packages/(in-memory|postgres|redis-pubsub|kafka|nats|streams)/",
        pathNot: "^packages/$1/",
      },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are forbidden.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Orphan modules (not imported anywhere) suggest dead code.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.[^/]+\\.json$",
          "(^|/)(tsup|vitest)\\.config\\.[^/]+$",
          "(^|/)src/index\\.ts$",
          "(^|/)src/ports/.+\\.ts$",
          "(^|/)dist/",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules|dist" },
    exclude: { path: "dist|node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(?:@[^/]+/)?[^/]+" },
    },
  },
};
