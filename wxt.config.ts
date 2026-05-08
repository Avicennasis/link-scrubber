import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Link Scrubber',
    description: 'Automatically strip or rewrite tracking parameters from URLs',
    permissions: ['storage', 'scripting', 'activeTab', 'tabs'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['/main-world.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
