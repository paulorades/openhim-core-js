/* eslint-env mocha */

import fs from 'fs'
import os from 'os'
import * as q from 'q'
import * as stats from '../../src/stats'
import FakeServer from '../fakeTcpServer'
import { config } from '../../src/config'

const application = config.get('application')
const domain = `${os.hostname()}.${application.name}`

describe('Stats Middleware ', () => {
  let s = {}

  beforeEach((done) => {
    s = new FakeServer()
    return s.start(done)
  })

  afterEach(() => s.stop())

  const channel = {
    _id: 'ckjhfjwedsnfdsf',
    name: 'Mock endpoint',
    urlPattern: '.+',
    routes: [{
      secured: true,
      host: 'localhost',
      port: 9877,
      primary: true,
      cert: fs.readFileSync('test/resources/server-tls/cert.pem')
    }
    ]
  }

  let requestTimestamp = (new Date()).toString()
  const ctx = {}
  ctx.authorisedChannel = channel
  ctx.request = {}
  ctx.response = {}
  ctx.response.set = function () { }
  ctx.path = (ctx.request.url = '/test')
  ctx.request.method = 'GET'
  ctx.requestTimestamp = requestTimestamp
  ctx.transactionStatus = 'Successful'
  ctx.routes = []
  ctx.mediatorResponse = {}
  ctx.mediatorResponse.properties =
    {name: 'primary mediator'}
  ctx.mediatorResponse.metrics = []
  ctx.mediatorResponse.orchestrations = [{
    name: 'Lab API',
    group: 'group',
    request: {
      path: 'api/patient/lab',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: '<route request>',
      method: 'POST',
      timestamp: 1412257881904
    },
    response: {
      status: '200',
      headers: {},
      body: '<route response>',
      timestamp: 1412257881909
    },
    metrics: []
  }
  ]

  // Non Primary routes
  ctx.routes.push({
    name: 'secondary route',
    request: {
      path: 'api/patient/lab',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: '<route request>',
      method: 'POST',
      timestamp: 1412257881904
    },
    response: {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: 'Primary Route Reached',
      timestamp: 1423489768398
    },

    orchestrations: [{
      name: 'Lab API',
      group: 'group',
      request: {
        path: 'api/patient/lab',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: '<route request>',
        method: 'POST',
        timestamp: 1412257881904
      },
      response: {
        status: '200',
        headers: {},
        body: '<route response>',
        timestamp: 1412257881909
      }
    }
    ]
  })

  // Adding Custom Metrics
  ctx.mediatorResponse.metrics.push({
    name: 'my-counter-metric',
    type: 'counter',
    value: 1
  })
  ctx.mediatorResponse.metrics.push({
    name: 'my-gauge-metric',
    type: 'gauge',
    value: 11
  })
  ctx.mediatorResponse.metrics.push({
    name: 'my-timer-metric',
    type: 'timer',
    value: 1522
  })

  // Has no groups
  requestTimestamp = (new Date()).toString()
  const ctx2 = {}
  ctx2.authorisedChannel = channel
  ctx2.request = {}
  ctx2.response = {}
  ctx2.response.set = function () { }
  ctx2.path = (ctx2.request.url = '/test')
  ctx2.request.method = 'GET'
  ctx2.requestTimestamp = requestTimestamp
  ctx2.transactionStatus = 'Successful'
  ctx2.routes = []
  ctx2.mediatorResponse = {}
  ctx2.mediatorResponse.properties =
    {name: 'primary mediator'}
  ctx2.mediatorResponse.metrics = []
  ctx2.mediatorResponse.orchestrations = [{
    name: 'Lab API',
    request: {
      path: 'api/patient/lab',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: '<route request>',
      method: 'POST',
      timestamp: 1412257881904
    },
    response: {
      status: '200',
      headers: {},
      body: '<route response>',
      timestamp: 1412257881909
    },
    metrics: []
  }
  ]

  // Non Primary routes
  ctx2.routes.push({
    name: 'secondary route',
    request: {
      path: 'api/patient/lab',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: '<route request>',
      method: 'POST',
      timestamp: 1412257881904
    },
    response: {
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: 'Primary Route Reached',
      timestamp: 1423489768398
    },

    orchestrations: [{
      name: 'Lab API',
      request: {
        path: 'api/patient/lab',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: '<route request>',
        method: 'POST',
        timestamp: 1412257881904
      },
      response: {
        status: '200',
        headers: {},
        body: '<route response>',
        timestamp: 1412257881909
      }
    }
    ]
  })

  // Adding Custom Metrics
  ctx2.mediatorResponse.metrics.push({
    name: 'my-counter-metric',
    type: 'counter',
    value: 1
  })
  ctx2.mediatorResponse.metrics.push({
    name: 'my-gauge-metric',
    type: 'gauge',
    value: 11
  })
  ctx2.mediatorResponse.metrics.push({
    name: 'my-timer-metric',
    type: 'timer',
    value: 1522
  })

  it('should increment the transaction counter', async (done) => {
    try {
      const incrementTransactionCount = q.nbind(stats.incrementTransactionCount, stats)
      const nonPrimaryRouteRequestCount = q.nbind(stats.nonPrimaryRouteRequestCount, stats)
      const expectMessage = q.nbind(s.expectMessage, s)

      await incrementTransactionCount(ctx)
      await incrementTransactionCount(ctx2)

      await nonPrimaryRouteRequestCount(ctx, ctx.routes[0])
      await nonPrimaryRouteRequestCount(ctx2, ctx2.routes[0])

      await expectMessage(`${domain}.channels:1|c`)
      await expectMessage(`${domain}.channels.Successful:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.group.Lab API:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.group.Lab API.statusCodes.200:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.statuses.Successful.orchestrations.group.Lab API:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.statuses.Successful.orchestrations.group.Lab API.statusCodes.200:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.primary mediator.mediator_metrics.my-counter-metric:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.primary mediator.mediator_metrics.my-gauge-metric:11|g`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.primary mediator.mediator_metrics.my-timer-metric:1522|ms`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.Lab API:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.Lab API.statusCodes.200:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.statuses.Successful.orchestrations.Lab API:1|c`)
      await expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.statuses.Successful.orchestrations.Lab API.statusCodes.200:1|c`)
      done()
    } catch (err) {
      done(err)
    }
  })

  // TODO : Fix this test
  it('Should measure transaction duration', (done) => {
    ctx.timer = 10
    return stats.measureTransactionDuration(ctx, () =>
      stats.measureTransactionDuration(ctx2, () =>
        stats.nonPrimaryRouteDurations(ctx, ctx.routes[0], () =>
          stats.nonPrimaryRouteDurations(ctx2, ctx2.routes[0], () =>
            s.expectMessage(`${domain}.channels:10|ms`, () =>
              s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.group.Lab API:5|ms`, () =>
                s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.group.Lab API.statusCodes.200:5|ms`, () =>
                  s.expectMessage(`${domain}.channels.Successful:10|ms`, () =>
                    s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf:10|ms`, () =>
                      s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.statuses.Successful:10|ms`, () =>
                        s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.nonPrimaryRoutes.secondary route:10|ms`, () =>
                          s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.nonPrimaryRoutes.secondary route.statusCodes.200:10|ms`, () =>
                            s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.nonPrimaryRoutes.secondary route.orchestrations.group.Lab API:5|ms`, () =>
                              s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.Lab API:5|ms`, () =>
                                s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.orchestrations.Lab API.statusCodes.200:5|ms`,
                                  () => s.expectMessage(`${domain}.channels.ckjhfjwedsnfdsf.nonPrimaryRoutes.secondary route.orchestrations.Lab API:5|ms`, done))
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  })
})
