/* eslint-env mocha */

import should from "should";
import request from "supertest";
import basicAuthentication from "../../lib/middleware/basicAuthentication";
import { Client } from "../../lib/model/clients";

const buildEmptyCtx = function() {
  const ctx = {};
  ctx.req = {};
  ctx.req.headers = {};
  return ctx;
};

const buildCtx = function(user, pass) {
  const authDetails = new Buffer(`${user}:${pass}`).toString("base64");
  const ctx = buildEmptyCtx();
  ctx.req.headers.authorization = `basic ${authDetails}`;
  return ctx;
};

const bcryptClient = {
  clientID: "user",
  clientDomain: "openhim.jembi.org",
  name: "TEST basic auth client",
  roles:
    [
      "PoC"
    ],
  passwordAlgorithm: "bcrypt",
  passwordHash: "$2a$10$w8GyqInkl72LMIQNpMM/fenF6VsVukyya.c6fh/GRtrKq05C2.Zgy",
  cert: ""
};

const shaClient = {
  clientID: "user",
  clientDomain: "openhim.jembi.org",
  name: "TEST basic auth client",
  roles:
    [
      "PoC"
    ],
  passwordAlgorithm: "sha512",
  passwordHash: "28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea",
  passwordSalt: "1234567890",
  cert: ""
};


describe("Basic Auth", () => {
  before(done => Client.remove({}, done));

  afterEach(done => Client.remove({}, done));

  describe("with no credentials", () =>
    it("ctx.authenticated should not exist", (done) => {
      const ctx = buildEmptyCtx();
      return basicAuthentication.authenticateUser(ctx, () => {
        ({}.should.not.equal(ctx.authenticated));
        return done();
      });
    })
  );

  describe("with unknown user", () =>
    it("ctx.authenticated should not exist", (done) => {
      const ctx = buildCtx("incorrect_user", "incorrect_password");
      return basicAuthentication.authenticateUser(ctx, () => {
        ({}.should.not.equal(ctx.authenticated));
        return done();
      });
    })
  );

  describe("default algorithm (bcrypt) with correct credentials", () =>
    it("ctx.authenticated should exist and contain the client object from the database ", (done) => {
      const client = new Client(bcryptClient);
      return client.save((error, newAppDoc) => {
        const ctx = buildCtx("user", "password");
        return basicAuthentication.authenticateUser(ctx, () => {
          should.exist(ctx.authenticated);
          should.exist(ctx.authenticated.clientID);
          ctx.authenticated.clientID.should.equal(bcryptClient.clientID);
          return done();
        });
      });
    })
  );

  describe("default algorithm (bcrypt) with incorrect credentials", () =>
    it("ctx.authenticated should not exist", (done) => {
      const client = new Client(bcryptClient);
      return client.save((error, newAppDoc) => {
        const ctx = buildCtx("user", "incorrectPassword");
        return basicAuthentication.authenticateUser(ctx, () => {
          should.not.exist(ctx.authenticated);
          return done();
        });
      });
    })
  );

  describe("crypto algorithm (sha) with correct credentials", () =>
    it("ctx.authenticated should exist and contain the client object from the database ", (done) => {
      const client = new Client(shaClient);
      return client.save((error, newAppDoc) => {
        const ctx = buildCtx("user", "password");
        return basicAuthentication.authenticateUser(ctx, () => {
          should.exist(ctx.authenticated);
          should.exist(ctx.authenticated.clientID);
          ctx.authenticated.clientID.should.equal(shaClient.clientID);
          return done();
        });
      });
    })
  );

  return describe("crypto algorithm (sha) with incorrect credentials", () =>
    it("ctx.authenticated should not exist", (done) => {
      const client = new Client(shaClient);
      return client.save((error, newAppDoc) => {
        const ctx = buildCtx("user", "incorrectPassword");
        return basicAuthentication.authenticateUser(ctx, () => {
          should.not.exist(ctx.authenticated);
          return done();
        });
      });
    })
  );
});