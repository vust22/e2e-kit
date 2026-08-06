/**
 * Local ESLint rules enforcing the authoring conventions in spec §7 / CONTRIBUTING.md.
 * Kept as a plain-JS local plugin so it needs no build step and no published package.
 */

/** Spec §3.4: every public page-object method carries a one-line `intent:` comment. */
const requireIntentComment = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Public page-object methods must carry a /** intent: ... */ comment; the healing harness uses it as context (spec §3.4, §9.3).',
    },
    schema: [],
    messages: {
      missing:
        "Public page-object method '{{name}}' is missing its `/** intent: ... */` comment (spec §3.4).",
      empty:
        "The `intent:` comment on '{{name}}' is empty. Describe the user-visible outcome, not the implementation.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    // Only page objects are subject to this rule — flows and fixtures are exempt.
    if (!/[/\\]pages[/\\]/.test(filename)) return {};

    const source = context.sourceCode ?? context.getSourceCode();

    return {
      MethodDefinition(node) {
        if (node.kind === 'constructor') return;
        if (node.accessibility === 'private' || node.accessibility === 'protected') return;
        if (node.key.type === 'PrivateIdentifier') return;

        const name = node.key.type === 'Identifier' ? node.key.name : '<computed>';
        const comments = source.getCommentsBefore(node);
        const intent = comments.find(
          (c) => c.type === 'Block' && /\bintent\s*:/i.test(c.value),
        );

        if (!intent) {
          context.report({ node: node.key, messageId: 'missing', data: { name } });
          return;
        }
        const text = intent.value.replace(/^\s*\*+/gm, '').replace(/.*intent\s*:/i, '').trim();
        if (text.length < 8) {
          context.report({ node: node.key, messageId: 'empty', data: { name } });
        }
      },
    };
  },
};

/** Spec §3.2: consumers and kit packages must not import Playwright directly. */
const noDirectPlaywrightImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Import test helpers from @invertus/e2e-core, which pins and re-exports Playwright (spec §3.2).',
    },
    schema: [],
    messages: {
      direct:
        "Import from '@invertus/e2e-core' instead of '{{source}}' — the kit pins the Playwright version (spec §3.2).",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    // The core package is the one place allowed to depend on Playwright.
    if (/[/\\]packages[/\\]core[/\\]/.test(filename)) return {};

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (src === '@playwright/test' || src === 'playwright' || src === 'playwright-core') {
          context.report({ node: node.source, messageId: 'direct', data: { source: src } });
        }
      },
    };
  },
};

export default {
  rules: {
    'require-intent-comment': requireIntentComment,
    'no-direct-playwright-import': noDirectPlaywrightImport,
  },
};
