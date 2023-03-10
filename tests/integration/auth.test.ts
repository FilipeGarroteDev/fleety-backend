import app, { init } from '@/app';
import { prismaPG } from '@/config';
import faker from '@faker-js/faker';
import { Roles, TicketStatus } from '@prisma/client';
import httpStatus from 'http-status';
import supertest from 'supertest';
import usersFactory from '../factory/users-factory';
import { createSession } from '../factory/sessions-factory';
import ticketsFactory from '../factory/tickets-factory';
import { cleanDb, generateValidToken } from '../utils';

beforeAll(async () => {
  await init();
});

beforeEach(async () => {
  await cleanDb();
});

const server = supertest(app);

describe('POST /api/auth/signin', () => {
  describe('when body is invalid', () => {
    it('should respond with status 422 when body isnt given', async () => {
      const response = await server.post('/api/auth/signin').send({});

      expect(response.status).toBe(httpStatus.UNPROCESSABLE_ENTITY);
    });

    it('should respond with status 422, if sign up data is invalid', async () => {
      const invalidSignInData = { [faker.lorem.word()]: faker.lorem.word() };

      const response = await server.post('/api/auth/signin').send(invalidSignInData);

      expect(response.status).toBe(httpStatus.UNPROCESSABLE_ENTITY);
    });
  });
  describe('when body is valid', () => {
    const generateValidSigninBody = () => ({
      name: faker.name.firstName(),
      password: faker.internet.password(),
    });

    it('should respond with status 401, if there is no user for given unique name', async () => {
      const validBody = generateValidSigninBody();

      const response = await server.post('/api/auth/signin').send(validBody);

      expect(response.status).toBe(httpStatus.UNAUTHORIZED);
    });

    it('should respond with status 401, if password doesnt match with user credentials', async () => {
      const validBody = generateValidSigninBody();
      await usersFactory.createUserByName(validBody.name, validBody.password);

      const response = await server.post('/api/auth/signin').send({ name: validBody.name, password: faker.lorem.word() });

      expect(response.status).toBe(httpStatus.UNAUTHORIZED);
    });

    describe('when credentials are valid', () => {
      it('should respond with status 200', async () => {
        const validBody = generateValidSigninBody();
        await usersFactory.createUserByName(validBody.name, validBody.password);
        const response = await server.post('/api/auth/signin').send(validBody);

        expect(response.status).toBe(httpStatus.OK);
      });

      it('should create reserved ticket, if there is no active ticket yet', async () => {
        const validBody = generateValidSigninBody();
        const user = await usersFactory.createUserByName(validBody.name, validBody.password);
        const response = await server.post('/api/auth/signin').send(validBody);

        expect(response.body.ticket).toEqual(
          expect.objectContaining({
            userId: user.id,
            status: TicketStatus.RESERVED,
          }),
        );
      });

      it('should create reserved ticket, if there is a paid ticket on db', async () => {
        const validBody = generateValidSigninBody();
        const user = await usersFactory.createUserByName(validBody.name, validBody.password);
        await ticketsFactory.createPaidTicket(user.id);
        const response = await server.post('/api/auth/signin').send(validBody);

        expect(response.body.ticket).toEqual(
          expect.objectContaining({
            userId: user.id,
            status: TicketStatus.RESERVED,
          }),
        );
      });

      it('shouldnt create ticket, if there is a reserved ticket on db', async () => {
        const validBody = generateValidSigninBody();
        const user = await usersFactory.createUserByName(validBody.name, validBody.password);
        const ticket = await ticketsFactory.createReservedTicket(user.id);
        const response = await server.post('/api/auth/signin').send(validBody);

        const createdTickets = await prismaPG.tickets.findMany({});

        expect(response.body.ticket).toEqual(
          expect.objectContaining({
            id: ticket.id,
            userId: user.id,
            status: TicketStatus.RESERVED,
          }),
        );
        expect(createdTickets.length).toBe(1);
      });

      it('should save ticket on db', async () => {
        const validBody = generateValidSigninBody();
        const user = await usersFactory.createUserByName(validBody.name, validBody.password);
        await ticketsFactory.createReservedTicket(user.id);
        const response = await server.post('/api/auth/signin').send(validBody);

        const ticket = await prismaPG.tickets.findFirst({
          where: {
            userId: user.id,
            status: TicketStatus.RESERVED,
          },
        });

        expect(ticket).toEqual(
          expect.objectContaining({
            id: response.body.ticket.id,
            userId: response.body.ticket.userId,
            status: TicketStatus.RESERVED,
          }),
        );
      });

      it('should respond with user data, token and ticket', async () => {
        const validBody = generateValidSigninBody();
        const createdUser = await usersFactory.createUserByName(validBody.name, validBody.password);
        const response = await server.post('/api/auth/signin').send(validBody);

        expect(response.body).toEqual(
          expect.objectContaining({
            user: expect.objectContaining({
              name: createdUser.name,
              role: createdUser.role,
              id: createdUser.id,
            }),
            token: expect.any(String),
          }),
        );
      });

      it('should correctly save token on db', async () => {
        const validBody = generateValidSigninBody();
        const createdUser = await usersFactory.createUserByName(validBody.name, validBody.password);
        const response = await server.post('/api/auth/signin').send(validBody);

        const session = await prismaPG.sessions.findFirst({
          where: {
            userId: createdUser.id,
          },
        });

        expect(response.body.token).toEqual(session.token);
      });
    });
  });
});

describe('GET /api/auth/validate', () => {
  it('should respond with status 401 when headers isnt given', async () => {
    const response = await server.get('/api/auth/validate');

    expect(response.status).toBe(httpStatus.UNAUTHORIZED);
  });

  it('should respond with status 401, if token isnt given', async () => {
    await usersFactory.createUserByName('Mesa 13', '123456');
    const response = await server.get('/api/auth/validate').set('Authorization', '');

    expect(response.status).toBe(httpStatus.UNAUTHORIZED);
  });

  it('should respond with status 401, if there is no active session with the given token', async () => {
    const user = await usersFactory.createUserByName('Mesa 13', '123456');
    const token = generateValidToken(user.id);
    const response = await server.get('/api/auth/validate').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(httpStatus.UNAUTHORIZED);
  });

  it('should respond with status 200, if there is active session token', async () => {
    const user = await usersFactory.createUserByName('Mesa 13', '123456');
    const token = generateValidToken(user.id);
    await createSession(user.id, token);
    const response = await server.get('/api/auth/validate').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(httpStatus.OK);
  });

  it('should respond with user name', async () => {
    const user = await usersFactory.createUserByName('Mesa 13', '123456');
    const token = generateValidToken(user.id);
    await createSession(user.id, token);
    const response = await server.get('/api/auth/validate').set('Authorization', `Bearer ${token}`);

    expect(response.body).toEqual(
      expect.objectContaining({
        name: user.name,
      }),
    );
  });
});

describe('POST /api/auth/admin/signin', () => {
  describe('when body is invalid', () => {
    const generateInvalidBody = () => ({
      name: faker.name.firstName(),
      email: faker.internet.email(),
      image: faker.internet.url(),
    });

    it('should respond with status 422 when body isnt given', async () => {
      const response = await server.post('/api/auth/admin/signin').send({});

      expect(response.status).toBe(httpStatus.UNPROCESSABLE_ENTITY);
    });

    it('should respond with status 422, if sign up data is invalid', async () => {
      const invalidSignInData = { [faker.lorem.word()]: faker.lorem.word() };

      const response = await server.post('/api/auth/admin/signin').send(invalidSignInData);

      expect(response.status).toBe(httpStatus.UNPROCESSABLE_ENTITY);
    });

    it('should respond with status 422, if restaurant secret key doesnt given', async () => {
      const invalidSignInData = generateInvalidBody();

      const response = await server.post('/api/auth/admin/signin').send(invalidSignInData);

      expect(response.status).toBe(httpStatus.UNPROCESSABLE_ENTITY);
    });
  });
  describe('when body is valid', () => {
    const generateValidSigninBody = (restaurantSecretKey: string) => ({
      name: faker.name.firstName(),
      email: faker.internet.email(),
      image: faker.internet.url(),
      restaurantSecretKey,
    });

    it('should respond with status 403, if the restaurant secret key isnt correct', async () => {
      const bodyWithWrongKey = generateValidSigninBody('unknown');

      const response = await server.post('/api/auth/admin/signin').send(bodyWithWrongKey);

      expect(response.status).toBe(httpStatus.FORBIDDEN);
    });

    it('should respond with status 401, if there is no registered admin', async () => {
      const validBody = generateValidSigninBody(process.env.RESTAURANT_SECRET_KEY);

      const response = await server.post('/api/auth/admin/signin').send(validBody);

      expect(response.status).toBe(httpStatus.UNAUTHORIZED);
    });

    describe('when credentials are valid', () => {
      it('should respond with status 200', async () => {
        const validBody = generateValidSigninBody(process.env.RESTAURANT_SECRET_KEY);
        await usersFactory.createNewAdmin(validBody.name, validBody.email);
        const response = await server.post('/api/auth/admin/signin').send(validBody);

        expect(response.status).toBe(httpStatus.OK);
      });

      it('should respond with admin data and token', async () => {
        const validBody = generateValidSigninBody(process.env.RESTAURANT_SECRET_KEY);
        const admin = await usersFactory.createNewAdmin(validBody.name, validBody.email);
        const response = await server.post('/api/auth/admin/signin').send(validBody);

        expect(response.body).toEqual(
          expect.objectContaining({
            user: expect.objectContaining({
              name: validBody.name,
              image: validBody.image,
              role: Roles.ADMIN,
              id: admin.id,
            }),
            token: expect.any(String),
          }),
        );
      });

      it('should correctly save token on db', async () => {
        const validBody = generateValidSigninBody(process.env.RESTAURANT_SECRET_KEY);
        const admin = await usersFactory.createNewAdmin(validBody.name, validBody.email);
        const response = await server.post('/api/auth/admin/signin').send(validBody);

        const session = await prismaPG.sessions.findFirst({
          where: {
            userId: admin.id,
          },
        });

        expect(response.body.token).toEqual(session.token);
      });
    });
  });
});
