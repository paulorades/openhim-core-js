/* eslint-env mocha */
/* eslint no-unused-expressions:0 */

import fs from 'fs'
import * as tlsAuthentication from '../../src/middleware/tlsAuthentication'
import { ClientModel } from '../../src/model/clients'
import * as testUtils from '../testUtils'
import { KeystoreModel } from '../../src/model/keystore'
import { config } from '../../src/config'

config.tlsClientLookup = config.get('tlsClientLookup')

describe('tlsAuthentication.coffee', () => {
  beforeEach(done => testUtils.setupTestKeystore(() => done()))

  afterEach(done => testUtils.cleanupTestKeystore(() => done()))

  describe('.getServerOptions', () => {
    it('should add all trusted certificates and enable mutual auth from all clients to server options if mutual auth is enabled', done =>
      tlsAuthentication.getServerOptions(true, (err, options) => {
        if (err) { return done(err) }
        options.ca.should.be.ok
        options.ca.should.be.an.Array
        options.ca.should.containEql((fs.readFileSync('test/resources/trust-tls/cert1.pem')).toString())
        options.ca.should.containEql((fs.readFileSync('test/resources/trust-tls/cert2.pem')).toString())
        options.requestCert.should.be.true
        options.rejectUnauthorized.should.be.false
        return done()
      })
    )

    it('should NOT have mutual auth options set if mutual auth is disabled', done =>
      tlsAuthentication.getServerOptions(false, (err, options) => {
        if (err) { return done(err) }
        options.should.not.have.property('ca')
        options.should.not.have.property('requestCert')
        options.should.not.have.property('rejectUnauthorized')
        return done()
      })
    )

    return it('should add the servers key and certificate to the server options', done =>
      tlsAuthentication.getServerOptions(false, (err, options) => {
        if (err) { return done(err) }
        options.cert.should.be.ok
        options.key.should.be.ok
        return done()
      })
    )
  })

  return describe('.clientLookup', () => {
    it('should find a client in the keystore up the chain', (done) => {
      const testClientDoc = {
        clientID: 'testApp',
        clientDomain: 'trust2.org',
        name: 'TEST Client',
        roles: [
          'OpenMRS_PoC',
          'PoC'
        ],
        passwordHash: '',
        certFingerprint: '8F:AB:2A:51:84:F2:ED:1B:13:2B:41:21:8B:78:D4:11:47:84:73:E6'
      }

      const client = new ClientModel(testClientDoc)
      return client.save(() => {
        config.tlsClientLookup.type = 'in-chain'
        const promise = tlsAuthentication.clientLookup('wont_be_found', 'test', 'trust2.org')
        return promise.then((result) => {
          result.should.have.property('clientID', client.clientID)
          return ClientModel.remove({}, () => done())
        }).catch(done)
      })
    })

    it('should resolve even if no cert are found in the keystore', (done) => {
      config.tlsClientLookup.type = 'in-chain'
      const promise = tlsAuthentication.clientLookup('you.wont.find.me', 'me.either')
      return promise.then(() => done())
    })

    return it('should resolve when the keystore.ca is empty', done =>
      KeystoreModel.findOneAndUpdate({}, {ca: []}, () => {
        config.tlsClientLookup.type = 'in-chain'
        const promise = tlsAuthentication.clientLookup('you.wont.find.me', 'me.either')
        return promise.then(() => done())
      })
    )
  })
})
