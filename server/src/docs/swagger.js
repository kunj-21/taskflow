import swaggerJsdoc from 'swagger-jsdoc';

const User = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
  },
};

const TaskInput = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] },
    priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
    dueDate: { type: 'string', format: 'date-time', nullable: true },
    assigneeId: { type: 'string', nullable: true },
    projectId: { type: 'string', description: 'Required on create' },
  },
};

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: { title: 'TaskFlow API', version: '1.0.0', description: 'Multi-tenant task management API. Org-scoped endpoints require an `X-Org-Id` header naming an organization the caller belongs to; roles (owner, admin, manager, member) are per organization.' },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        User,
        TaskInput,
        Task: {
          allOf: [
            TaskInput,
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                number: { type: 'integer', description: 'Per-project sequence; display as <project.key>-<number>' },
                project: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } } },
                creatorId: { type: 'string' },
                assignee: { $ref: '#/components/schemas/User' },
                creator: { $ref: '#/components/schemas/User' },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          ],
        },
        TaskPage: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        RegisterInput: {
          type: 'object',
          required: ['email', 'name', 'password'],
          properties: {
            email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string', minLength: 8 },
            orgName: { type: 'string', description: 'Creates a new organization owned by the user. Required unless inviteToken is given.' },
            inviteToken: { type: 'string', description: 'Join an existing organization; the invite email must match.' },
          },
        },
        LoginInput: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
        Organization: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, plan: { type: 'string', enum: ['FREE', 'PRO', 'ENTERPRISE'] }, role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] } } },
        Session: { type: 'object', properties: { accessToken: { type: 'string' }, user: { $ref: '#/components/schemas/User' }, organizations: { type: 'array', items: { $ref: '#/components/schemas/Organization' } } } },
      },
    },
  },
  apis: ['./src/modules/**/*.routes.js'],
});
