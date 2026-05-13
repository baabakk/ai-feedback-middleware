import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ai-feedback-middleware",
  description:
    "Composable Performance Feedback Middleware for AI Agents. A plug-and-play, event-sourced middleware for capturing, interpreting, and operationalizing feedback to improve LLM and agent performance.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  // Pre-existing legacy doc content has 7 links to paths outside docs/
  // (../../packages/..., ../../TECH-DEBT, etc.) that VitePress can't
  // resolve into its dist tree. Tracked as a docs-audit follow-up;
  // tightening this gate once those links are converted to absolute
  // github.com URLs.
  ignoreDeadLinks: true,

  // GitHub Pages serves the site under /ai-feedback-middleware/ (project page).
  // base is "/<repo>/" so all asset URLs resolve.
  base: "/ai-feedback-middleware/",

  head: [
    ["meta", { name: "theme-color", content: "#3c8772" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "ai-feedback-middleware" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Composable Performance Feedback Middleware for AI Agents. Event-sourced, multi-axis polarity, plug-and-play.",
      },
    ],
  ],

  themeConfig: {
    siteTitle: "ai-feedback-middleware",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Concepts", link: "/concepts/ports-and-adapters" },
      { text: "Adapters", link: "/adapters/postgres-setup" },
      { text: "Cookbooks", link: "/cookbooks/threshold-crystallization" },
      {
        text: "v0.3",
        items: [
          {
            text: "Changelog",
            link: "https://github.com/baabakk/ai-feedback-middleware/blob/main/CHANGELOG.md",
          },
          {
            text: "Examples (12)",
            link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples",
          },
          {
            text: "Tech debt",
            link: "https://github.com/baabakk/ai-feedback-middleware/blob/main/TECH-DEBT.md",
          },
        ],
      },
    ],

    sidebar: {
      "/": [
        {
          text: "Introduction",
          items: [
            { text: "What is ai-feedback-middleware?", link: "/" },
            { text: "Getting Started", link: "/getting-started" },
            { text: "Why this exists", link: "/why" },
          ],
        },
        {
          text: "Concepts",
          collapsed: false,
          items: [
            { text: "Ports and Adapters", link: "/concepts/ports-and-adapters" },
            { text: "Event Sourcing Basics", link: "/concepts/event-sourcing-basics" },
            { text: "The 2×2 Framework", link: "/concepts/the-2x2-framework" },
            { text: "Middleware Pipeline", link: "/concepts/middleware-pipeline" },
          ],
        },
        {
          text: "Adapters",
          collapsed: false,
          items: [
            { text: "Choosing a Bus", link: "/adapters/choosing-a-bus" },
            { text: "Postgres Setup", link: "/adapters/postgres-setup" },
            { text: "Writing a Custom Adapter", link: "/adapters/writing-a-custom-adapter" },
          ],
        },
        {
          text: "Cookbooks",
          collapsed: false,
          items: [
            {
              text: "Threshold Crystallization",
              link: "/cookbooks/threshold-crystallization",
            },
          ],
        },
        {
          text: "Examples (on GitHub)",
          collapsed: true,
          items: [
            {
              text: "email-draft-approval",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/email-draft-approval",
            },
            {
              text: "daily-briefing-silent-accept",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/daily-briefing-silent-accept",
            },
            {
              text: "regenerate-burst-tuning",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/regenerate-burst-tuning",
            },
            {
              text: "topk-rag-selection",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/topk-rag-selection",
            },
            {
              text: "slack-approval-bot",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/slack-approval-bot",
            },
            {
              text: "multi-tenant-feedback",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/multi-tenant-feedback",
            },
            {
              text: "minimal-nodejs",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/minimal-nodejs",
            },
            {
              text: "postgres-only",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/postgres-only",
            },
            {
              text: "postgres-redis",
              link: "https://github.com/baabakk/ai-feedback-middleware/tree/main/examples/postgres-redis",
            },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/baabakk/ai-feedback-middleware" },
    ],

    footer: {
      message: "Apache 2.0 License",
      copyright: "Copyright © 2026 Babak Abbaschian and contributors",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/baabakk/ai-feedback-middleware/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
