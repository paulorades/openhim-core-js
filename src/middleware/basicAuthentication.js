import auth from "basic-auth";
import Q from "q";
import logger from "winston";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import SDC from "statsd-client";
import os from "os";
import { Client } from "../model/clients";
import config from "../config/config";

const statsdServer = config.get("statsd");
const application = config.get("application");

const domain = `${os.hostname()}.${application.name}.appMetrics`;
const sdc = new SDC(statsdServer);

const bcryptCompare = (pass, client, callback) => bcrypt.compare(pass, client.passwordHash, callback);

function cryptoCompare(pass, client, callback) {
	const hash = crypto.createHash(client.passwordAlgorithm);
	hash.update(pass);
	hash.update(client.passwordSalt);
	if (hash.digest("hex") === client.passwordHash) {
		return callback(null, true);
	} else {
		return callback(null, false);
	}
}

function comparePasswordWithClientHash(pass, client, callback) {
	let needle;
	if (Array.from(crypto.getHashes()).includes(client.passwordAlgorithm)) {
		return cryptoCompare(pass, client, callback);
	} else {
		return bcryptCompare(pass, client, callback);
	}
}


export function authenticateUser(ctx, done) {
	const user = auth(ctx);

	if (user) {
		return Client.findOne({ clientID: user.name }, (err, client) => {
			if (err) { return done(err); }

			if (client) {
				if (!(client.passwordAlgorithm && client.passwordHash)) {
					logger.warn(`${user.name} does not have a basic auth password set`);
					return done(null, null);
				}

				return comparePasswordWithClientHash(user.pass, client, (err, res) => {
					if (err) { return done(err); }

					if (res) {
						logger.info(`${user.name} is authenticated.`);
						ctx.authenticated = client;
						ctx.authenticationType = "basic";
						return done(null, client);
					} else {
						logger.info(`${user.name} could NOT be authenticated, trying next auth mechanism if any...`);
						return done(null, null);
					}
				});
			} else {
				logger.info(`${user.name} not found, trying next auth mechanism if any...`);
				return done(null, null);
			}
		});
	} else {
		logger.info("No basic auth details supplied, trying next auth mechanism if any...");
		ctx.authenticated = null; // Set to empty object rather than null
		return done(null, null);
	}
}

/*
 * Koa middleware for authentication by basic auth
 */
export function* koaMiddleware(next) {
	let startTime;
	if (statsdServer.enabled) { startTime = new Date(); }
	if (this.authenticated != null) {
		return yield next;
	} else {
		const authenticateUser = Q.denodeify(exports.authenticateUser);
		yield authenticateUser(this);
		if ((this.authenticated != null ? this.authenticated.clientID : undefined) != null) {
			this.header["X-OpenHIM-ClientID"] = this.authenticated.clientID;
		}
		if (statsdServer.enabled) { sdc.timing(`${domain}.basicAuthMiddleware`, startTime); }
		return yield next;
	}
}