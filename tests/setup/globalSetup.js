import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

export async function setup() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.ANTHROPIC_API_KEY = 'sk-test-fake-key';
  process.env.AGENT_APPROVAL_MODE = 'false';
  process.env.SMARTLEAD_API_KEY = 'test-smartlead-key';
  process.env.SMARTLEAD_WEBHOOK_SECRET = '';
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_FROM_EMAIL = 'test@menuchat.it';
  process.env.SERPAPI_KEY = 'test-serpapi-key';
  process.env.JWT_SECRET = 'test-jwt-secret-for-signed-urls-32chars!';
  process.env.BACKEND_URL = 'http://localhost:3099';
  process.env.CRM_API_URL = 'http://localhost:3098';
  process.env.CRM_API_KEY = 'test-crm-key';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.NODE_ENV = 'test';
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.TWILIO_WHATSAPP_NUMBER = '+390000000000';
  process.env.TWILIO_AGENT_TEMPLATE_SID = '(test)';
}

export async function teardown() {
  if (mongod) await mongod.stop();
}
