/* eslint-env mocha */

import should from 'should'
import https from 'https'
import fs from 'fs'
import request from 'supertest'
import FormData from 'form-data'
import { ChannelModelAPI } from '../../src/model/channels'
import { ClientModelAPI } from '../../src/model/clients'
import { TransactionModelAPI } from '../../src/model/transactions'
import { KeystoreModelAPI } from '../../src/model/keystore'
import * as testUtils from '../testUtils'
import * as server from '../../src/server'
import { config } from '../../src/config'

config.authentication = config.get('authentication')
config.tlsClientLookup = config.get('tlsClientLookup')

describe('e2e Integration Tests', () => {
  describe('Authentication and authorisation tests', () => {
    describe('Mutual TLS', () => {
      let mockServer = null

      before((done) => {
        config.authentication.enableMutualTLSAuthentication = true
        config.authentication.enableBasicAuthentication = false

        // Setup some test data
        const channel1 = new ChannelModelAPI({
          name: 'TEST DATA - Mock endpoint',
          urlPattern: 'test/mock',
          allow: ['PoC'],
          routes: [{
            name: 'test route',
            host: 'localhost',
            port: 1232,
            primary: true
          }
          ]
        })
        channel1.save((err) => {
          if (err) { return done(err) }
          const testClientDoc1 = {
            clientID: 'testApp',
            clientDomain: 'test-client.jembi.org',
            name: 'TEST Client',
            roles: [
              'OpenMRS_PoC',
              'PoC'
            ],
            passwordHash: '',
            certFingerprint: '6D:BF:A5:BE:D7:F5:01:C2:EC:D0:BC:74:A4:12:5A:6F:36:C4:77:5C'
          }

          const testClientDoc2 = {
            clientID: 'testApp2',
            clientDomain: 'ca.openhim.org',
            name: 'TEST Client 2',
            roles: [
              'OpenMRS_PoC',
              'PoC'
            ],
            passwordHash: '',
            certFingerprint: '18:B7:F9:52:FA:37:86:C5:F5:63:DA:8B:FA:E6:6B:4D:FB:A0:27:ED'
          }

          const client1 = new ClientModelAPI(testClientDoc1)
          const client2 = new ClientModelAPI(testClientDoc2)

          ClientModelAPI.remove({}, () => client1.save(() => client2.save(() =>
              // remove default keystore
              KeystoreModelAPI.remove({}, () => {
                const keystore = new KeystoreModelAPI({
                  key: fs.readFileSync('test/resources/server-tls/key.pem'),
                  cert: {
                    data: fs.readFileSync('test/resources/server-tls/cert.pem'),
                    fingerprint: '23:37:6A:5E:A9:13:A4:8C:66:C5:BB:9F:0E:0D:68:9B:99:80:10:FC'
                  },
                  ca: [{
                    data: fs.readFileSync('test/resources/client-tls/cert.pem'),
                    fingerprint: '6D:BF:A5:BE:D7:F5:01:C2:EC:D0:BC:74:A4:12:5A:6F:36:C4:77:5C'
                  },
                  {
                    data: fs.readFileSync('test/resources/trust-tls/chain/intermediate.cert.pem'),
                    fingerprint: '3B:21:0A:F1:D2:ED:4F:9B:9C:02:71:DF:4E:14:1B:3E:32:F5:B9:BB'
                  },
                  {
                    data: fs.readFileSync('test/resources/trust-tls/chain/ca.cert.pem'),
                    fingerprint: '18:B7:F9:52:FA:37:86:C5:F5:63:DA:8B:FA:E6:6B:4D:FB:A0:27:ED'
                  }
                  ]
                })

                keystore.save((err) => {
                  if (err) { done(err) }

                  mockServer = testUtils.createMockServer(201, 'Mock response body\n', 1232, () => done())
                })
              })
            )
            )
          )
        })
      })

      after(done =>
        ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
          ClientModelAPI.remove({clientID: 'testApp'}, () =>
            ClientModelAPI.remove({clientID: 'testApp2'}, () =>
              mockServer.close(() => done())
            )
          )
        )
      )

      afterEach(done =>
        server.stop(() => done())
      )

      it('should forward a request to the configured routes if the client is authenticated and authorised', done =>
        server.start({httpPort: 5001, httpsPort: 5000}, () => {
          const options = {
            host: 'localhost',
            path: '/test/mock',
            port: 5000,
            cert: fs.readFileSync('test/resources/client-tls/cert.pem'),
            key: fs.readFileSync('test/resources/client-tls/key.pem'),
            ca: [fs.readFileSync('test/resources/server-tls/cert.pem')]
          }

          const req = https.request(options, (res) => {
            res.statusCode.should.be.exactly(201)
            return done()
          })
          req.end()
        })
      )

      it('should reject a request when using an invalid cert', done =>
        server.start({httpPort: 5001, httpsPort: 5000}, () => {
          const options = {
            host: 'localhost',
            path: '/test/mock',
            port: 5000,
            cert: fs.readFileSync('test/resources/client-tls/invalid-cert.pem'),
            key: fs.readFileSync('test/resources/client-tls/invalid-key.pem'),
            ca: [fs.readFileSync('test/resources/server-tls/cert.pem')]
          }

          const req = https.request(options, (res) => {
            res.statusCode.should.be.exactly(401)
            return done()
          })
          req.end()
        })
      )

      it('should authenticate a client further up the chain if \'in-chain\' config is set', (done) => {
        config.tlsClientLookup.type = 'in-chain'
        server.start({httpPort: 5001, httpsPort: 5000}, () => {
          const options = {
            host: 'localhost',
            path: '/test/mock',
            port: 5000,
            cert: fs.readFileSync('test/resources/trust-tls/chain/test.openhim.org.cert.pem'),
            key: fs.readFileSync('test/resources/trust-tls/chain/test.openhim.org.key.pem'),
            ca: [fs.readFileSync('test/resources/server-tls/cert.pem')]
          }

          const req = https.request(options, (res) => {
            res.statusCode.should.be.exactly(201)
            return done()
          })
          req.end()
        })
      })

      it('should reject a request with an invalid cert if \'in-chain\' config is set', (done) => {
        config.tlsClientLookup.type = 'in-chain'
        server.start({httpPort: 5001, httpsPort: 5000}, () => {
          const options = {
            host: 'localhost',
            path: '/test/mock',
            port: 5000,
            cert: fs.readFileSync('test/resources/client-tls/invalid-cert.pem'),
            key: fs.readFileSync('test/resources/client-tls/invalid-key.pem'),
            ca: [fs.readFileSync('test/resources/server-tls/cert.pem')]
          }

          const req = https.request(options, (res) => {
            res.statusCode.should.be.exactly(401)
            return done()
          })
          req.end()
        })
      })

      it('should NOT authenticate a client further up the chain if \'strict\' config is set', (done) => {
        config.tlsClientLookup.type = 'strict'
        server.start({httpPort: 5001, httpsPort: 5000}, () => {
          const options = {
            host: 'localhost',
            path: '/test/mock',
            port: 5000,
            cert: fs.readFileSync('test/resources/trust-tls/chain/test.openhim.org.cert.pem'),
            key: fs.readFileSync('test/resources/trust-tls/chain/test.openhim.org.key.pem'),
            ca: [fs.readFileSync('test/resources/server-tls/cert.pem')]
          }

          const req = https.request(options, (res) => {
            res.statusCode.should.be.exactly(401)
            return done()
          })
          req.end()
        })
      })
    })

    describe('Basic Authentication', () => {
      let mockServer = null

      before((done) => {
        config.authentication.enableMutualTLSAuthentication = false
        config.authentication.enableBasicAuthentication = true

        // Setup some test data
        const channel1 = new ChannelModelAPI({
          name: 'TEST DATA - Mock endpoint',
          urlPattern: 'test/mock',
          allow: ['PoC'],
          routes: [{
            name: 'test route',
            host: 'localhost',
            port: 1232,
            primary: true
          }
          ]
        })
        channel1.save((err) => {
          if (err) { return done(err) }
          const testAppDoc = {
            clientID: 'testApp',
            clientDomain: 'openhim.jembi.org',
            name: 'TEST Client',
            roles: [
              'OpenMRS_PoC',
              'PoC'
            ],
            passwordAlgorithm: 'bcrypt',
            passwordHash: '$2a$10$w8GyqInkl72LMIQNpMM/fenF6VsVukyya.c6fh/GRtrKq05C2.Zgy',
            cert: ''
          }

          const client = new ClientModelAPI(testAppDoc)
          client.save((err, newAppDoc) => {
            if (err) { return done(err) }
            mockServer = testUtils.createMockServer(200, 'Mock response body 1\n', 1232, () => done())
          }
          )
        })
      })

      after(done =>
        ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
          ClientModelAPI.remove({clientID: 'testApp'}, () =>
            mockServer.close(() => done())
          )
        )
      )

      afterEach(done =>
        server.stop(() => done())
      )

      describe('with no credentials', () =>
        it('should `throw` 401', done =>
          server.start({httpPort: 5001}, () =>
            request('http://localhost:5001')
              .get('/test/mock')
              .expect(401)
              .end((err, res) => {
                if (err) {
                  return done(err)
                } else {
                  return done()
                }
              })
          )
        )
      )

      describe('with incorrect credentials', () =>
        it('should `throw` 401', done =>
          server.start({httpPort: 5001}, () =>
            request('http://localhost:5001')
              .get('/test/mock')
              .auth('incorrect_user', 'incorrect_password')
              .expect(401)
              .expect('WWW-Authenticate', 'Basic')
              .end((err, res) => {
                if (err) {
                  return done(err)
                } else {
                  return done()
                }
              })
          )
        )
      )

      describe('with correct credentials', () =>
        it('should return 200 OK', done =>
          server.start({httpPort: 5001}, () =>
            request('http://localhost:5001')
              .get('/test/mock')
              .auth('testApp', 'password')
              .expect(200)
              .end((err, res) => {
                if (err) {
                  return done(err)
                } else {
                  return done()
                }
              })
          )
        )
      )
    })
  })

  describe('POST and PUT tests', () => {
    let mockServer = null
    let mockServerWithReturn = null
    const testDoc = '<test>test message</test>'

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint',
        urlPattern: '/test/mock',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ]
      })

      const channel2 = new ChannelModelAPI({
        name: 'TEST DATA - Mock With Return endpoint',
        urlPattern: '/gmo',
        allow: ['PoC'],
        routes: [{
          name: 'test route return',
          host: 'localhost',
          port: 1499,
          primary: true
        }
        ]
      })

      const channel3 = new ChannelModelAPI({
        name: 'TEST DATA - Mock With Return endpoint public',
        urlPattern: '/public',
        allow: [],
        authType: 'public',
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ]
      })

      const channel4 = new ChannelModelAPI({
        name: 'TEST DATA - Mock With Return endpoint private - whitelist',
        urlPattern: '/private',
        allow: [],
        whitelist: ['::ffff:127.0.0.1', '127.0.0.1'], // localhost in IPV6
        authType: 'public',
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ]
      })

      const channel5 = new ChannelModelAPI({
        name: 'TEST DATA - whitelist but un-authorised',
        urlPattern: '/un-auth',
        allow: ['private'],
        whitelist: ['::ffff:127.0.0.1', '127.0.0.1'], // localhost in IPV6
        authType: 'private',
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ]
      })

      const channel6 = new ChannelModelAPI({
        name: 'TEST DATA - whitelist but authorised',
        urlPattern: '/auth',
        allow: ['PoC'],
        whitelist: ['::ffff:127.0.0.1', '127.0.0.1'], // localhost in IPV6
        authType: 'private',
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ]
      })

      channel1.save(err => {
        if (err) { return done(err) }
        channel2.save(err => {
          if (err) { return done(err) }
          channel3.save(err => {
            if (err) { return done(err) }
            channel4.save(err => {
              if (err) { return done(err) }
              channel5.save(err => {
                if (err) { return done(err) }
                channel6.save((err) => {
                  if (err) { return done(err) }
                  const testAppDoc = {
                    clientID: 'testApp',
                    clientDomain: 'test-client.jembi.org',
                    name: 'TEST Client',
                    roles: [
                      'OpenMRS_PoC',
                      'PoC'
                    ],
                    passwordAlgorithm: 'sha512',
                    passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
                    passwordSalt: '1234567890',
                    cert: ''
                  }

                  const client = new ClientModelAPI(testAppDoc)
                  client.save((err, newAppDoc) => {
                    if (err) { return done(err) }
                              // Create mock endpoint to forward requests to
                    mockServer = testUtils.createMockServerForPost(201, 400, testDoc)
                    mockServerWithReturn = testUtils.createMockServerForPostWithReturn(201, 400, testDoc)
                    mockServer.listen(1232, () => mockServerWithReturn.listen(1499, done))
                  })
                })
              }
                      )
            }
                  )
          }
              )
        }
          )
      }
      )
    })

    after(done =>
      ChannelModelAPI.remove({}, () =>
        ClientModelAPI.remove({clientID: 'testApp'}, () =>
          mockServer.close(() =>
            mockServerWithReturn.close(() => done())
          )
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should return 201 CREATED on POST', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/test/mock')
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on POST - Public Channel', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/public')
          .send(testDoc)
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on POST - Public Channel with whitelisted ip', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/private')
          .send(testDoc)
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should deny access on POST - Private Channel with whitelisted IP but incorrect client role', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/un-auth')
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(401)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on POST - Private Channel with whitelisted IP and correct client role', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/auth')
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on PUT', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .put('/test/mock')
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should decompress gzip', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .put('/gmo')
          .set('Accept-Encoding', '') // Unset encoding, because supertest defaults to gzip,deflate
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(201)
          .expect(testDoc, done)
      )
    )

    it('should returned gzipped response', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .put('/gmo')
          .set('Accept-Encoding', 'gzip')
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(201)
          .expect('content-encoding', 'gzip')
          .expect(testDoc)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )
  })

  describe('HTTP header tests', () => {
    let mockServer = null
    const testDoc = '<test>test message</test>'

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint',
        urlPattern: 'test/mock',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 6262,
          primary: true
        }
        ]
      })
      channel1.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'testApp',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
            // Create mock endpoint to forward requests to
          mockServer = testUtils.createMockServer(201, testDoc, 6262, () => done())
        }
        )
      })
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
        ClientModelAPI.remove({clientID: 'testApp'}, () =>
          mockServer.close(() => done())
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should keep HTTP headers of the response intact', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/mock')
          .send(testDoc)
          .auth('testApp', 'password')
          .expect(201)
          .expect('Content-Type', 'text/plain; charset=utf-8')
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )
  })

  describe('HTTP body content matching - XML', () => {
    let mockServer = null
    const testXMLDoc = `\
<careServicesRequest>
  <function uuid='4e8bbeb9-f5f5-11e2-b778-0800200c9a66'>
    <codedType code="2221" codingScheme="ISCO-08" />
      <address>
        <addressLine component='city'>Kigali</addressLine>
      </address>
    <max>5</max>
  </function>
</careServicesRequest>\
`

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint',
        urlPattern: 'test/mock',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ],
        matchContentTypes: ['text/xml'],
        matchContentXpath: 'string(/careServicesRequest/function/@uuid)',
        matchContentValue: '4e8bbeb9-f5f5-11e2-b778-0800200c9a66'
      })
      channel1.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'testApp',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
          // Create mock endpoint to forward requests to
          mockServer = testUtils.createMockServerForPost(201, 400, testXMLDoc)

          mockServer.listen(1232, done)
        })
      })
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
        ClientModelAPI.remove({clientID: 'testApp'}, () =>
          mockServer.close(() => done())
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should return 201 CREATED on POST', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/test/mock')
          .set('Content-Type', 'text/xml')
          .send(testXMLDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on PUT', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .put('/test/mock')
          .set('Content-Type', 'text/xml')
          .send(testXMLDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )
  })

  describe('HTTP body content matching - JSON', () => {
    let mockServer = null
    const testJSONDoc = `\
{
  "functionId": 1234,
  "personId": "987",
  "name": "John Smith"
}\
`

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint',
        urlPattern: 'test/mock',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ],
        matchContentTypes: ['text/x-json', 'application/json'],
        matchContentJson: 'functionId',
        matchContentValue: '1234'
      })
      channel1.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'testApp',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
          // Create mock endpoint to forward requests to
          mockServer = testUtils.createMockServerForPost(201, 400, testJSONDoc)

          mockServer.listen(1232, done)
        })
      })
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
        ClientModelAPI.remove({clientID: 'testApp'}, () =>
          mockServer.close(() => done())
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should return 201 CREATED on POST', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/test/mock')
          .set('Content-Type', 'application/json')
          .send(testJSONDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on PUT', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .put('/test/mock')
          .set('Content-Type', 'application/json')
          .send(testJSONDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )
  })

  describe('HTTP body content matching - RegEx', () => {
    let mockServer = null
    const testRegExDoc = 'facility: OMRS123'

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint',
        urlPattern: 'test/mock',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ],
        matchContentRegex: '\\s[A-Z]{4}\\d{3}'
      })
      channel1.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'testApp',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
          // Create mock endpoint to forward requests to
          mockServer = testUtils.createMockServerForPost(201, 400, testRegExDoc)

          mockServer.listen(1232, done)
        })
      })
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
        ClientModelAPI.remove({clientID: 'testApp'}, () =>
          mockServer.close(() => done())
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should return 201 CREATED on POST', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .post('/test/mock')
          .send(testRegExDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )

    it('should return 201 CREATED on PUT', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .put('/test/mock')
          .send(testRegExDoc)
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              return done()
            }
          })
      )
    )
  })

  describe('mediator tests', () => {
    let mockServer = null

    const mediatorResponse = {
      status: 'Successful',
      response: {
        status: 200,
        headers: {},
        body: '<transaction response>',
        timestamp: new Date()
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
          timestamp: new Date()
        },
        response: {
          status: 200,
          headers: {},
          body: '<route response>',
          timestamp: new Date()
        }
      }
      ],
      properties: {
        orderId: 'TEST00001',
        documentId: '1f49c3e0-3cec-4292-b495-5bd41433a048'
      }
    }

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      const mediatorChannel = new ChannelModelAPI({
        name: 'TEST DATA - Mock mediator endpoint',
        urlPattern: 'test/mediator',
        allow: ['PoC'],
        routes: [{
          name: 'mediator route',
          host: 'localhost',
          port: 1244,
          primary: true
        }
        ]
      })
      mediatorChannel.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'mediatorTestApp',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
          mockServer = testUtils.createMockMediatorServer(200, mediatorResponse, 1244, () => done())
        })
      })
    })

    beforeEach(done => TransactionModelAPI.remove({}, done))

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock mediator endpoint'}, () =>
        ClientModelAPI.remove({clientID: 'mediatorTestApp'}, () =>
          mockServer.close(() => done())
        )
      )
    )

    afterEach(done =>
      server.stop(() =>
        TransactionModelAPI.remove({}, () => done())
      )
    )

    describe('mediator response processing', () => {
      it('should return the specified mediator response element as the actual response', done =>
        server.start({httpPort: 5001}, () =>
          request('http://localhost:5001')
            .get('/test/mediator')
            .auth('mediatorTestApp', 'password')
            .expect(200)
            .end((err, res) => {
              if (err) {
                done(err)
              }

              res.body.toString().should.equal(mediatorResponse.response.body)
              done()
            })
        )
      )

      it('should setup the correct metadata on the transaction as specified by the mediator response', done =>
        server.start({httpPort: 5001}, () =>
          request('http://localhost:5001')
            .get('/test/mediator')
            .auth('mediatorTestApp', 'password')
            .expect(200)
            .end((err, res) => {
              if (err) {
                return done(err)
              } else {
                setTimeout(() =>
                  TransactionModelAPI.findOne({}, (err, res) => {
                    if (err) { return done(err) }
                    res.status.should.be.equal(mediatorResponse.status)
                    res.orchestrations.length.should.be.exactly(1)
                    res.orchestrations[0].name.should.be.equal(mediatorResponse.orchestrations[0].name)
                    should.exist(res.properties)
                    res.properties.orderId.should.be.equal(mediatorResponse.properties.orderId)
                    return done()
                  }), 150 * global.testTimeoutFactor
                )
              }
            })
        )
      )
    })
  })

  describe('Multipart form data tests', () => {
    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      const mediatorResponse = {
        status: 'Successful',
        response: {
          status: 200,
          headers: {},
          body: '<transaction response>',
          timestamp: new Date()
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
            timestamp: new Date()
          },
          response: {
            status: 200,
            headers: {},
            body: '<route response>',
            timestamp: new Date()
          }
        }
        ]
      }

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint - multipart',
        urlPattern: '/test/multipart',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1276,
          primary: true
        }
        ]
      })

      channel1.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'testAppMultipart',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
          testUtils.createMockMediatorServer(200, mediatorResponse, 1276, () => done())
        })
      })
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint - multipart'}, () =>
        ClientModelAPI.remove({clientID: 'testAppMultipart'}, () => done())
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should return 201 CREATED on POST', done =>
      server.start({httpPort: 5001}, () => {
        const form = new FormData()
        form.append('my_field', 'my value')
        form.append('unix', fs.readFileSync('test/resources/files/unix.txt'))
        form.append('mac', fs.readFileSync('test/resources/files/mac.txt'))
        form.append('msdos', fs.readFileSync('test/resources/files/msdos.txt'))
        form.submit({
          host: 'localhost',
          port: 5001,
          path: '/test/multipart',
          auth: 'testAppMultipart:password',
          method: 'post'
        }, (err, res) => {
          res.statusCode.should.equal(200)
          res.on('data', (chunk) => { })
          //   chunk.should.be.ok
          if (err) {
            return done(err)
          } else {
            return done()
          }
        })
      })
    )
  })

  describe('URL rewriting e2e test', () => {
    let mockServer = null

    const jsonResponse =
      {href: 'http://localhost:1232/test/mock'}

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      // Setup some test data
      const channel1 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint',
        urlPattern: 'test/mock',
        allow: ['PoC'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1232,
          primary: true
        }
        ],
        rewriteUrls: true
      })
      channel1.save((err) => {
        if (err) { return done(err) }
        const testAppDoc = {
          clientID: 'testApp',
          clientDomain: 'test-client.jembi.org',
          name: 'TEST Client',
          roles: [
            'OpenMRS_PoC',
            'PoC'
          ],
          passwordAlgorithm: 'sha512',
          passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
          passwordSalt: '1234567890',
          cert: ''
        }

        const client = new ClientModelAPI(testAppDoc)
        client.save((err, newAppDoc) => {
          if (err) { return done(err) }
            // Create mock endpoint to forward requests to
          mockServer = testUtils.createMockServer(201, JSON.stringify(jsonResponse), 1232, () => done())
        }
        )
      })
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint'}, () =>
        ClientModelAPI.remove({clientID: 'testApp'}, () =>
          mockServer.close(() => done())
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should rewrite response urls', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/mock')
          .auth('testApp', 'password')
          .expect(201)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              const response = JSON.parse(res.text)
              response.href.should.be.exactly('http://localhost:5001/test/mock')
              return done()
            }
          })
      )
    )
  })

  describe('Routes enabled/disabled tests', () => {
    let mockServer1 = null
    let mockServer2 = null

    const channel1 = new ChannelModelAPI({
      name: 'TEST DATA - Mock endpoint 1',
      urlPattern: '^/test/channel1$',
      allow: ['PoC'],
      routes: [
        {
          name: 'test route',
          host: 'localhost',
          port: 1233,
          primary: true
        }, {
          name: 'test route 2',
          host: 'localhost',
          port: 1234
        }
      ]
    })
    const channel2 = new ChannelModelAPI({
      name: 'TEST DATA - Mock endpoint 2',
      urlPattern: '^/test/channel2$',
      allow: ['PoC'],
      routes: [
        {
          name: 'test route',
          host: 'localhost',
          port: 1233,
          status: 'disabled'
        }, {
          name: 'test route 2',
          host: 'localhost',
          port: 1234,
          primary: true,
          status: 'enabled'
        }
      ]
    })
    const channel3 = new ChannelModelAPI({
      name: 'TEST DATA - Mock endpoint 3',
      urlPattern: '^/test/channel3$',
      allow: ['PoC'],
      routes: [
        {
          name: 'test route',
          host: 'localhost',
          port: 1233,
          primary: true,
          status: 'enabled'
        }, {
          name: 'test route 2',
          host: 'localhost',
          port: 1234,
          primary: true,
          status: 'disabled'
        }
      ]
    })

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      channel1.save(err => {
        if (err) { return done(err) }
        channel2.save(err => {
          if (err) { return done(err) }
          channel3.save((err) => {
            if (err) { return done(err) }

            const testAppDoc = {
              clientID: 'testApp',
              clientDomain: 'test-client.jembi.org',
              name: 'TEST Client',
              roles: [
                'OpenMRS_PoC',
                'PoC'
              ],
              passwordAlgorithm: 'sha512',
              passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
              passwordSalt: '1234567890',
              cert: ''
            }

            const client = new ClientModelAPI(testAppDoc)
            client.save((err, newAppDoc) => {
              if (err) { return done(err) }
                    // Create mock endpoint to forward requests to
              mockServer1 = testUtils.createMockServer(200, 'target1', 1233, () => {
                mockServer2 = testUtils.createMockServer(200, 'target2', 1234, () => done())
              })
            }
                )
          })
        }
          )
      }
      )
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 1'}, () =>
        ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 2'}, () =>
          ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 3'}, () =>
            ClientModelAPI.remove({clientID: 'testApp'}, () =>
              mockServer1.close(() =>
                mockServer2.close(() => done())
              )
            )
          )
        )
      )
    )

    afterEach(done => server.stop(() => TransactionModelAPI.remove({}, done)))

    beforeEach(done => TransactionModelAPI.remove({}, done))

    it('should route transactions to routes that have no status specified (default: enabled)', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/channel1')
          .auth('testApp', 'password')
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.text.should.be.exactly('target1')
              // routes are async
              setTimeout(() =>
                  TransactionModelAPI.findOne({}, (err, trx) => {
                    if (err) { return done(err) }
                    trx.routes.length.should.be.exactly(1)
                    trx.routes[0].should.have.property('name', 'test route 2')
                    trx.routes[0].response.body.should.be.exactly('target2')
                    return done()
                  })
                , 150 * global.testTimeoutFactor)
            }
          })
      )
    )

    it('should NOT route transactions to disabled routes', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/channel2')
          .auth('testApp', 'password')
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.text.should.be.exactly('target2')
              // routes are async
              setTimeout(() =>
                  TransactionModelAPI.findOne({}, (err, trx) => {
                    if (err) { return done(err) }
                    trx.routes.length.should.be.exactly(0)
                    return done()
                  })
                , 150 * global.testTimeoutFactor)
            }
          })
      )
    )

    it('should ignore disabled primary routes (multiple primary routes)', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/channel3')
          .auth('testApp', 'password')
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.text.should.be.exactly('target1')
              // routes are async
              setTimeout(() =>
                  TransactionModelAPI.findOne({}, (err, trx) => {
                    if (err) { return done(err) }
                    trx.routes.length.should.be.exactly(0)
                    return done()
                  })
                , 150 * global.testTimeoutFactor)
            }
          })
      )
    )
  })

  describe('Channel priority tests', () => {
    let mockServer1 = null
    let mockServer2 = null

    const channel1 = new ChannelModelAPI({
      name: 'TEST DATA - Mock endpoint 1',
      urlPattern: '^/test/undefined/priority$',
      allow: ['PoC'],
      routes: [{
        name: 'test route',
        host: 'localhost',
        port: 1234,
        primary: true
      }
      ]
    })
    const channel2 = new ChannelModelAPI({
      name: 'TEST DATA - Mock endpoint 2',
      urlPattern: '^/.*$',
      priority: 3,
      allow: ['PoC'],
      routes: [{
        name: 'test route',
        host: 'localhost',
        port: 1233,
        primary: true
      }
      ]
    })
    const channel3 = new ChannelModelAPI({
      name: 'TEST DATA - Mock endpoint 3',
      urlPattern: '^/test/mock$',
      priority: 2,
      allow: ['PoC'],
      routes: [{
        name: 'test route',
        host: 'localhost',
        port: 1234,
        primary: true
      }
      ]
    })

    before((done) => {
      config.authentication.enableMutualTLSAuthentication = false
      config.authentication.enableBasicAuthentication = true

      channel1.save(err => {
        if (err) { return done(err) }
        channel2.save(err => {
          if (err) { return done(err) }
          channel3.save((err) => {
            if (err) { return done(err) }
            const testAppDoc = {
              clientID: 'testApp',
              clientDomain: 'test-client.jembi.org',
              name: 'TEST Client',
              roles: [
                'OpenMRS_PoC',
                'PoC'
              ],
              passwordAlgorithm: 'sha512',
              passwordHash: '28dce3506eca8bb3d9d5a9390135236e8746f15ca2d8c86b8d8e653da954e9e3632bf9d85484ee6e9b28a3ada30eec89add42012b185bd9a4a36a07ce08ce2ea',
              passwordSalt: '1234567890',
              cert: ''
            }

            const client = new ClientModelAPI(testAppDoc)
            client.save((err, newAppDoc) => {
              if (err) { return done(err) }
                    // Create mock endpoint to forward requests to
              mockServer1 = testUtils.createMockServer(200, 'target1', 1233,
                      () => { mockServer2 = testUtils.createMockServer(200, 'target2', 1234, () => done()) })
            }
                )
          })
        }
          )
      }
      )
    })

    after(done =>
      ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 1'}, () =>
        ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 2'}, () =>
          ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 3'}, () =>
            ChannelModelAPI.remove({name: 'TEST DATA - Mock endpoint 4'}, () =>
              ClientModelAPI.remove({clientID: 'testApp'}, () =>
                mockServer1.close(() =>
                  mockServer2.close(() => done())
                )
              )
            )
          )
        )
      )
    )

    afterEach(done =>
      server.stop(() => done())
    )

    it('should route to the channel with higher priority if multiple channels match a request', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/mock')
          .auth('testApp', 'password')
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.text.should.be.exactly('target2') // should route to target2 via channel3
              return done()
            }
          })
      )
    )

    it('should treat a channel with an undefined priority with lowest priority', done =>
      server.start({httpPort: 5001}, () =>
        request('http://localhost:5001')
          .get('/test/undefined/priority')
          .auth('testApp', 'password')
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.text.should.be.exactly('target1') // should route to target1 via channel2
              return done()
            }
          })
      )
    )

    it('should deny access if multiple channels match but the top priority channel denies access', (done) => {
      const channel4 = new ChannelModelAPI({
        name: 'TEST DATA - Mock endpoint 4',
        urlPattern: '^/test/mock$',
        priority: 1,
        allow: ['something else'],
        routes: [{
          name: 'test route',
          host: 'localhost',
          port: 1234,
          primary: true
        }
        ]
      })

      channel4.save(() =>

        server.start({httpPort: 5001}, () =>
          request('http://localhost:5001')
            .get('/test/mock')
            .auth('testApp', 'password')
            .expect(401)
            .end((err, res) => {
              if (err) {
                return done(err)
              } else {
                return done()
              }
            })
        )
      )
    })
  })
})
