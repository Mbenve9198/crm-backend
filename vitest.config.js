import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup/envSetup.js'],
    coverage: {
      provider: 'v8',
      include: [
        'services/salesAgentService.js',
        'services/agentToolsService.js',
        'services/replyClassifierService.js',
        'services/rankCheckerAgentService.js',
        'services/signedUrlService.js',
        'controllers/smartleadWebhookController.js'
      ]
    }
  }
});
