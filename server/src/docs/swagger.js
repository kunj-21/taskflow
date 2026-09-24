import swaggerJsdoc from 'swagger-jsdoc';

const User = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    role: { type: 'string', enum: ['ADMIN', 'MANAGER', 'MEMBER'] },
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
  },
};

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: { title: 'TaskFlow API', version: '1.0.0', description: 'Task management API with RBAC, caching, jobs and real-time events.' },
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
          properties: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string', minLength: 8 } },
        },
        LoginInput: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
        Session: { type: 'object', properties: { accessToken: { type: 'string' }, user: { $ref: '#/components/schemas/User' } } },
      },
    },
  },
  apis: ['./src/modules/**/*.routes.js'],
});
