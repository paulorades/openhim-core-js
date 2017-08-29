import util from "util";
import zlib from "zlib";
import http from "http";
import https from "https";
import net from "net";
import tls from "tls";
import Q from "q";
import logger from "winston";
import cookie from "cookie";
import fs from "fs";
import SDC from "statsd-client";
import os from "os";
import { config } from "../config";
import * as utils from "../utils";
import * as messageStore from "../middleware/messageStore";
import * as events from "../middleware/events";
import * as stats from "../stats";

config.mongo = config.get("mongo");
config.router = config.get("router");

const statsdServer = config.get("statsd");
const application = config.get("application");

const domain = `${os.hostname()}.${application.name}.appMetrics`;
const sdc = new SDC(statsdServer);


const isRouteEnabled = route => (route.status == null) || (route.status === "enabled");

export function numberOfPrimaryRoutes(routes) {
  let numPrimaries = 0;
  for (const route of Array.from(routes)) {
    if (isRouteEnabled(route) && route.primary) { numPrimaries++; }
  }
  return numPrimaries;
}

const containsMultiplePrimaries = routes => numberOfPrimaryRoutes(routes) > 1;


function setKoaResponse(ctx, response) {
    // Try and parse the status to an int if it is a string
  let err;
  if (typeof response.status === "string") {
    try {
      response.status = parseInt(response.status, 10);
    } catch (error) {
      err = error;
      logger.error(err);
    }
  }

  ctx.response.status = response.status;
  ctx.response.timestamp = response.timestamp;
  ctx.response.body = response.body;

  if (!ctx.response.header) {
    ctx.response.header = {};
  }

  if (ctx.request != null && ctx.request.header != null && ctx.request.header["X-OpenHIM-TransactionID"] != null) {
    if ((response != null ? response.headers : undefined) != null) {
      response.headers["X-OpenHIM-TransactionID"] = ctx.request.header["X-OpenHIM-TransactionID"];
    }
  }

  const result = [];
  for (const key in response.headers) {
    const value = response.headers[key];
    switch (key.toLowerCase()) {
      case "set-cookie": result.push(setCookiesOnContext(ctx, value)); break;
      case "location":
        if ((response.status >= 300) && (response.status < 400)) {
          result.push(ctx.response.redirect(value));
        } else {
          result.push(ctx.response.set(key, value));
        }
        break;
      case "content-type": result.push(ctx.response.type = value); break;
      default:
        try {
                    // Strip the content and transfer encoding headers
          if ((key !== "content-encoding") && (key !== "transfer-encoding")) {
            result.push(ctx.response.set(key, value));
          }
        } catch (error1) {
          err = error1;
          result.push(logger.error(err));
        }
    }
  }
  return result;
}

if (process.env.NODE_ENV === "test") {
  exports.setKoaResponse = setKoaResponse;
}

function setCookiesOnContext(ctx, value) {
  logger.info("Setting cookies on context");
  const result = [];
  for (let c_value = 0; c_value < value.length; c_value++) {
    let p_val;
    const c_key = value[c_value];
    const c_opts = { path: false, httpOnly: false }; // clear out default values in cookie module
    const c_vals = {};
    const object = cookie.parse(c_key);
    for (const p_key in object) {
      p_val = object[p_key];
      const p_key_l = p_key.toLowerCase();
      switch (p_key_l) {
        case "max-age": c_opts.maxage = parseInt(p_val, 10); break;
        case "expires": c_opts.expires = new Date(p_val); break;
        case "path": case "domain": case "secure": case "signed": case "overwrite": c_opts[p_key_l] = p_val; break;
        case "httponly": c_opts.httpOnly = p_val; break;
        default: c_vals[p_key] = p_val;
      }
    }

        // TODO : Refactor this code when possible
    result.push((() => {
      const result1 = [];
      for (const p_key in c_vals) {
        p_val = c_vals[p_key];
        result1.push(ctx.cookies.set(p_key, p_val, c_opts));
      }
      return result1;
    })());
  }
  return result;
}

function handleServerError(ctx, err, route) {
  ctx.autoRetry = true;
  if (route) {
    route.error = {
      message: err.message,
      stack: err.stack ? err.stack : undefined
    };
  } else {
    ctx.response.status = 500;
    ctx.response.timestamp = new Date();
    ctx.response.body = "An internal server error occurred";
        // primary route error
    ctx.error = {
      message: err.message,
      stack: err.stack ? err.stack : undefined
    };
  }

  logger.error(`[${(ctx.transactionId != null ? ctx.transactionId.toString() : undefined)}] Internal server error occured: ${err}`);
  if (err.stack) { return logger.error(`${err.stack}`); }
}


function sendRequestToRoutes(ctx, routes, next) {
  const promises = [];
  let promise = {};
  ctx.timer = new Date();

  if (containsMultiplePrimaries(routes)) {
    return next(new Error("Cannot route transaction: Channel contains multiple primary routes and only one primary is allowed"));
  }

  return utils.getKeystore((err, keystore) => {
    for (const route of Array.from(routes)) {
      if (!isRouteEnabled(route)) { continue; }

      const path = getDestinationPath(route, ctx.path);
      const options = {
        hostname: route.host,
        port: route.port,
        path,
        method: ctx.request.method,
        headers: ctx.request.header,
        agent: false,
        rejectUnauthorized: true,
        key: keystore.key,
        cert: keystore.cert.data,
        secureProtocol: "TLSv1_method"
      };

      if (route.cert != null) {
        options.ca = keystore.ca.id(route.cert).data;
      }

      if (ctx.request.querystring) {
        options.path += `?${ctx.request.querystring}`;
      }

      if (options.headers && options.headers.authorization && !route.forwardAuthHeader) {
        delete options.headers.authorization;
      }

      if (route.username && route.password) {
        options.auth = `${route.username}:${route.password}`;
      }

      if (options.headers && options.headers.host) {
        delete options.headers.host;
      }

      if (route.primary) {
        ctx.primaryRoute = route;
        promise = sendRequest(ctx, route, options)
                    .then((response) => {
                      logger.info(`executing primary route : ${route.name}`);
                      if (response.headers != null && response.headers["content-type"] != null && response.headers["content-type"].indexOf("application/json+openhim") > -1) {
                            // handle mediator reponse
                        const responseObj = JSON.parse(response.body);
                        ctx.mediatorResponse = responseObj;

                        if (responseObj.error != null) {
                          ctx.autoRetry = true;
                          ctx.error = responseObj.error;
                        }

                            // then set koa response from responseObj.response
                        return setKoaResponse(ctx, responseObj.response);
                      } else {
                        return setKoaResponse(ctx, response);
                      }
                    }).then(() => {
                      logger.info("primary route completed");
                      return next();
                    }).fail((reason) => {
                        // on failure
                      handleServerError(ctx, reason);
                      return next();
                    });
      } else {
        logger.info(`executing non primary: ${route.name}`);
        promise = buildNonPrimarySendRequestPromise(ctx, route, options, path)
                    .then((routeObj) => {
                      logger.info(`Storing non primary route responses ${route.name}`);

                      try {
                        if (((routeObj != null ? routeObj.name : undefined) == null)) {
                          routeObj =
                                    { name: route.name };
                        }

                        if (((routeObj != null ? routeObj.response : undefined) == null)) {
                          routeObj.response = {
                            status: 500,
                            timestamp: ctx.requestTimestamp
                          };
                        }

                        if (((routeObj != null ? routeObj.request : undefined) == null)) {
                          routeObj.request = {
                            host: options.hostname,
                            port: options.port,
                            path,
                            headers: ctx.request.header,
                            querystring: ctx.request.querystring,
                            method: ctx.request.method,
                            timestamp: ctx.requestTimestamp
                          };
                        }

                        return messageStore.storeNonPrimaryResponse(ctx, routeObj, () =>
                                stats.nonPrimaryRouteRequestCount(ctx, routeObj, () => stats.nonPrimaryRouteDurations(ctx, routeObj, () => { }))
                            );
                      } catch (err) {
                        return logger.error(err);
                      }
                    });
      }


      promises.push(promise);
    }

    return (Q.all(promises)).then(() =>
            messageStore.setFinalStatus(ctx, () => {
              logger.info(`All routes completed for transaction: ${ctx.transactionId.toString()}`);
              if (ctx.routes) {
                logger.debug(`Storing route events for transaction: ${ctx.transactionId}`);
                const done = (err) => {
                  if (err) {
                    return logger.error(err);
                  }
                };
                const trxEvents = [];

                events.createSecondaryRouteEvents(trxEvents, ctx.transactionId, ctx.requestTimestamp, ctx.authorisedChannel, ctx.routes, ctx.currentAttempt);
                return events.saveEvents(trxEvents, done);
              }
            })
        );
  });
}


// function to build fresh promise for transactions routes
const buildNonPrimarySendRequestPromise = (ctx, route, options, path) =>
    sendRequest(ctx, route, options)
        .then((response) => {
          const routeObj = {};
          routeObj.name = route.name;
          routeObj.request = {
            host: options.hostname,
            port: options.port,
            path,
            headers: ctx.request.header,
            querystring: ctx.request.querystring,
            method: ctx.request.method,
            timestamp: ctx.requestTimestamp
          };

          if (response.headers != null && response.headers["content-type"] != null && response.headers["content-type"].indexOf("application/json+openhim") > -1) {
                // handle mediator reponse
            const responseObj = JSON.parse(response.body);
            routeObj.mediatorURN = responseObj["x-mediator-urn"];
            routeObj.orchestrations = responseObj.orchestrations;
            routeObj.properties = responseObj.properties;
            if (responseObj.metrics) { routeObj.metrics = responseObj.metrics; }
            routeObj.response = responseObj.response;
          } else {
            routeObj.response = response;
          }

          if (!ctx.routes) { ctx.routes = []; }
          ctx.routes.push(routeObj);
          return routeObj;
        }).fail((reason) => {
            // on failure
          const routeObj = {};
          routeObj.name = route.name;
          handleServerError(ctx, reason, routeObj);
          return routeObj;
        })
    ;

function sendRequest(ctx, route, options) {
  if ((route.type === "tcp") || (route.type === "mllp")) {
    logger.info("Routing socket request");
    return sendSocketRequest(ctx, route, options);
  } else {
    logger.info("Routing http(s) request");
    return sendHttpRequest(ctx, route, options);
  }
}

function obtainCharset(headers) {
  const contentType = headers["content-type"] || "";
  const matches = contentType.match(/charset=([^;,\r\n]+)/i);
  if (matches && matches[1]) {
    return matches[1];
  }
  return "utf-8";
}

/*
 * A promise returning function that send a request to the given route and resolves
 * the returned promise with a response object of the following form:
 *   response =
 *    status: <http_status code>
 *    body: <http body>
 *    headers: <http_headers_object>
 *    timestamp: <the time the response was recieved>
 */
function sendHttpRequest(ctx, route, options) {
  const defered = Q.defer();
  const response = {};

  const gunzip = zlib.createGunzip();
  const inflate = zlib.createInflate();

  let method = http;

  if (route.secured) {
    method = https;
  }

  const routeReq = method.request(options, (routeRes) => {
    response.status = routeRes.statusCode;
    response.headers = routeRes.headers;

    const uncompressedBodyBufs = [];
    if (routeRes.headers["content-encoding"] === "gzip") { // attempt to gunzip
      routeRes.pipe(gunzip);

      gunzip.on("data", (data) => {
        uncompressedBodyBufs.push(data);
      });
    }

    if (routeRes.headers["content-encoding"] === "deflate") { // attempt to inflate
      routeRes.pipe(inflate);

      inflate.on("data", (data) => {
        uncompressedBodyBufs.push(data);
      });
    }

    const bufs = [];
    routeRes.on("data", chunk => bufs.push(chunk));

        // See https://www.exratione.com/2014/07/nodejs-handling-uncertain-http-response-compression/
    return routeRes.on("end", () => {
      response.timestamp = new Date();
      const charset = obtainCharset(routeRes.headers);
      if (routeRes.headers["content-encoding"] === "gzip") {
        return gunzip.on("end", () => {
          const uncompressedBody = Buffer.concat(uncompressedBodyBufs);
          response.body = uncompressedBody.toString(charset);
          if (!defered.promise.isRejected()) {
            defered.resolve(response);
          }
        });
      } else if (routeRes.headers["content-encoding"] === "deflate") {
        return inflate.on("end", () => {
          const uncompressedBody = Buffer.concat(uncompressedBodyBufs);
          response.body = uncompressedBody.toString(charset);
          if (!defered.promise.isRejected()) {
            defered.resolve(response);
          }
        });
      } else {
        response.body = Buffer.concat(bufs);
        if (!defered.promise.isRejected()) {
          return defered.resolve(response);
        }
      }
    });
  });

  routeReq.on("error", err => defered.reject(err));

  routeReq.on("clientError", err => defered.reject(err));

  routeReq.setTimeout(+config.router.timeout, () => defered.reject("Request Timed Out"));

  if ((ctx.request.method === "POST") || (ctx.request.method === "PUT")) {
    routeReq.write(ctx.body);
  }

  routeReq.end();

  return defered.promise;
}

/*
 * A promise returning function that send a request to the given route using sockets and resolves
 * the returned promise with a response object of the following form: ()
 *   response =
 *    status: <200 if all work, else 500>
 *    body: <the received data from the socket>
 *    timestamp: <the time the response was recieved>
 *
 * Supports both normal and MLLP sockets
 */
function sendSocketRequest(ctx, route, options) {
  const mllpEndChar = String.fromCharCode(0o034);

  const defered = Q.defer();
  const requestBody = ctx.body;
  const response = {};

  let method = net;
  if (route.secured) {
    method = tls;
  }

  options = {
    host: options.hostname,
    port: options.port,
    rejectUnauthorized: options.rejectUnauthorized,
    key: options.key,
    cert: options.cert,
    secureProtocol: options.secureProtocol,
    ca: options.ca
  };

  const client = method.connect(options, () => {
    logger.info(`Opened ${route.type} connection to ${options.host}:${options.port}`);
    if (route.type === "tcp") {
      return client.end(requestBody);
    } else if (route.type === "mllp") {
      return client.write(requestBody);
    } else {
      return logger.error(`Unkown route type ${route.type}`);
    }
  });

  const bufs = [];
  client.on("data", (chunk) => {
    bufs.push(chunk);
    if ((route.type === "mllp") && (chunk.toString().indexOf(mllpEndChar) > -1)) {
      logger.debug("Received MLLP response end character");
      return client.end();
    }
  });

  client.on("error", err => defered.reject(err));

  client.on("clientError", err => defered.reject(err));

  client.on("end", () => {
    logger.info(`Closed ${route.type} connection to ${options.host}:${options.port}`);

    if (route.secured && !client.authorized) {
      return defered.reject(new Error("Client authorization failed"));
    }
    response.body = Buffer.concat(bufs);
    response.status = 200;
    response.timestamp = new Date();
    if (!defered.promise.isRejected()) {
      return defered.resolve(response);
    }
  });

  return defered.promise;
}

function getDestinationPath(route, requestPath) {
  if (route.path) {
    return route.path;
  } else if (route.pathTransform) {
    return transformPath(requestPath, route.pathTransform);
  } else {
    return requestPath;
  }
}

/*
 * Applies a sed-like expression to the path string
 *
 * An expression takes the form s/from/to
 * Only the first 'from' match will be substituted
 * unless the global modifier as appended: s/from/to/g
 *
 * Slashes can be escaped as \/
 */
export function transformPath(path, expression) {
    // replace all \/'s with a temporary ':' char so that we don't split on those
    // (':' is safe for substitution since it cannot be part of the path)
  let fromRegex;
  const sExpression = expression.replace(/\\\//g, ":");
  const sub = sExpression.split("/");

  const from = sub[1].replace(/:/g, "/");
  let to = sub.length > 2 ? sub[2] : "";
  to = to.replace(/:/g, "/");

  if ((sub.length > 3) && (sub[3] === "g")) {
    fromRegex = new RegExp(from, "g");
  } else {
    fromRegex = new RegExp(from);
  }

  return path.replace(fromRegex, to);
}


/*
 * Gets the authorised channel and routes
 * the request to all routes within that channel. It updates the
 * response of the context object to reflect the response recieved from the
 * route that is marked as 'primary'.
 *
 * Accepts (ctx, next) where ctx is a [Koa](http://koajs.com/) context
 * object and next is a callback that is called once the route marked as
 * primary has returned an the ctx.response object has been updated to
 * reflect the response from that route.
 */
export function route(ctx, next) {
  const channel = ctx.authorisedChannel;
  return sendRequestToRoutes(ctx, channel.routes, next);
}

/*
 * The [Koa](http://koajs.com/) middleware function that enables the
 * router to work with the Koa framework.
 *
 * Use with: app.use(router.koaMiddleware)
 */
export function* koaMiddleware(next) {
  let startTime;
  if (statsdServer.enabled) { startTime = new Date(); }
  const _route = Q.denodeify(route);
  yield _route(this);
  if (statsdServer.enabled) { sdc.timing(`${domain}.routerMiddleware`, startTime); }
  return yield next;
}