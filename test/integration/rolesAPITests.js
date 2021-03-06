/* eslint-env mocha */

import request from 'supertest'
import * as server from '../../src/server'
import { ChannelModelAPI } from '../../src/model/channels'
import { ClientModelAPI } from '../../src/model/clients'
import * as testUtils from '../testUtils'

const {auth} = testUtils

describe('API Integration Tests', () =>

  describe('Roles REST Api testing', () => {
    const channel1 = {
      name: 'TestChannel1',
      urlPattern: 'test/sample',
      allow: ['role1', 'role2', 'client4'],
      routes: [{
        name: 'test route',
        host: 'localhost',
        port: 9876,
        primary: true
      }]
    }

    const channel2 = {
      name: 'TestChannel2',
      urlPattern: 'test/sample',
      allow: ['role2', 'role3'],
      routes: [{
        name: 'test route',
        host: 'localhost',
        port: 9876,
        primary: true
      }]
    }

    const client1 = {
      clientID: 'client1',
      name: 'Client 1',
      roles: [
        'role1'
      ]
    }

    const client2 = {
      clientID: 'client2',
      name: 'Client 2',
      roles: [
        'role2'
      ]
    }

    const client3 = {
      clientID: 'client3',
      name: 'Client 3',
      roles: [
        'role1',
        'role3'
      ]
    }

    const client4 = {
      clientID: 'client4',
      name: 'Client 4',
      roles: [
        'other-role'
      ]
    }

    let authDetails = {}

    before(done =>
      auth.setupTestUsers((err) => {
        if (err) { return done(err) }
        return server.start({apiPort: 8080}, () => {
          authDetails = auth.getAuthDetails()
          return done()
        })
      })
    )

    after(done =>
      ClientModelAPI.remove({}, () =>
        ChannelModelAPI.remove({}, () =>
          server.stop(() =>
            auth.cleanupTestUsers(() => done())
          )
        )
      )
    )

    beforeEach(done =>
      ClientModelAPI.remove({}, () =>
        (new ClientModelAPI(client1)).save((err, cl1) => {
          if (err) { return done(err) }
          client1._id = cl1._id
          return (new ClientModelAPI(client2)).save((err, cl2) => {
            if (err) { return done(err) }
            client2._id = cl2._id
            return (new ClientModelAPI(client3)).save((err, cl3) => {
              if (err) { return done(err) }
              client3._id = cl3._id
              return (new ClientModelAPI(client4)).save((err, cl4) => {
                if (err) { return done(err) }
                client4._id = cl4._id
                return ChannelModelAPI.remove({}, () =>
                (new ChannelModelAPI(channel1)).save((err, ch1) => {
                  if (err) { return done(err) }
                  channel1._id = ch1._id
                  return (new ChannelModelAPI(channel2)).save((err, ch2) => {
                    if (err) { return done(err) }
                    channel2._id = ch2._id
                    return done()
                  })
                })
                )
              })
            })
          })
        })
      )
    )

    describe('*getRoles()', () => {
      it('should fetch all roles and list linked channels', done =>
        request('https://localhost:8080')
          .get('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.body.length.should.be.exactly(4)
              const names = res.body.map(r => r.name)
              names.should.containEql('role1')
              names.should.containEql('role2')
              names.should.containEql('role3')
              names.should.containEql('other-role')

              const mapChId = chns => chns.map(ch => ch._id)
              for (const role of Array.from(res.body)) {
                role.should.have.property('channels')

                if (role.name === 'role1') {
                  mapChId(role.channels).should.containEql(`${channel1._id}`)
                }
                if (role.name === 'role2') {
                  mapChId(role.channels).should.containEql(`${channel1._id}`)
                  mapChId(role.channels).should.containEql(`${channel2._id}`)
                }
                if (role.name === 'role3') {
                  mapChId(role.channels).should.containEql(`${channel2._id}`)
                }
              }

              return done()
            }
          })
      )

      it('should fetch all roles and list linked clients', done =>
        request('https://localhost:8080')
          .get('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.body.length.should.be.exactly(4)
              const names = res.body.map(r => r.name)
              names.should.containEql('role1')
              names.should.containEql('role2')
              names.should.containEql('role3')
              names.should.containEql('other-role')

              const mapClId = cls => cls.map(cl => cl._id)
              for (const role of Array.from(res.body)) {
                role.should.have.property('clients')

                if (role.name === 'role1') {
                  mapClId(role.clients).should.containEql(`${client1._id}`)
                  mapClId(role.clients).should.containEql(`${client3._id}`)
                }
                if (role.name === 'role2') {
                  mapClId(role.clients).should.containEql(`${client2._id}`)
                }
                if (role.name === 'role3') {
                  mapClId(role.clients).should.containEql(`${client3._id}`)
                  if (role.name === 'other-role') {
                    mapClId(role.clients).should.containEql(`${client4._id}`)
                  }
                }
              }

              return done()
            }
          })
      )

      it('should fetch all roles if there are only linked clients', done =>
        ChannelModelAPI.remove({}, () =>
          request('https://localhost:8080')
            .get('/roles')
            .set('auth-username', testUtils.rootUser.email)
            .set('auth-ts', authDetails.authTS)
            .set('auth-salt', authDetails.authSalt)
            .set('auth-token', authDetails.authToken)
            .expect(200)
            .end((err, res) => {
              if (err) {
                return done(err)
              } else {
                res.body.length.should.be.exactly(4)
                const names = res.body.map(r => r.name)
                names.should.containEql('role1')
                names.should.containEql('role2')
                names.should.containEql('role3')
                names.should.containEql('other-role')

                const mapClId = cls => cls.map(cl => cl._id)
                for (const role of Array.from(res.body)) {
                  role.should.have.property('clients')

                  if (role.name === 'role1') {
                    mapClId(role.clients).should.containEql(`${client1._id}`)
                    mapClId(role.clients).should.containEql(`${client3._id}`)
                  }
                  if (role.name === 'role2') {
                    mapClId(role.clients).should.containEql(`${client2._id}`)
                  }
                  if (role.name === 'role3') {
                    mapClId(role.clients).should.containEql(`${client3._id}`)
                  }
                  if (role.name === 'other-role') {
                    mapClId(role.clients).should.containEql(`${client4._id}`)
                  }
                }

                return done()
              }
            })
        )
      )

      it('should not misinterpret a client as a role', done =>
        request('https://localhost:8080')
          .get('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.body.length.should.be.exactly(4)
              const names = res.body.map(r => r.name)
              names.should.not.containEql('client4')
              return done()
            }
          })
      )

      return it('should reject a request from a non root user', done =>
        request('https://localhost:8080')
          .get('/roles')
          .set('auth-username', testUtils.nonRootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(403)
          .end((err, res) => done(err))
      )
    })

    describe('*getRole()', () => {
      it('should get a role', done =>
        request('https://localhost:8080')
          .get('/roles/role2')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.body.should.have.property('name', 'role2')
              res.body.should.have.property('channels')
              res.body.should.have.property('clients')
              res.body.channels.length.should.be.exactly(2)
              const mapId = arr => arr.map(a => a._id)
              mapId(res.body.channels).should.containEql(`${channel1._id}`)
              mapId(res.body.channels).should.containEql(`${channel2._id}`)
              mapId(res.body.clients).should.containEql(`${client2._id}`)
              return done()
            }
          })
      )

      it('should get a role that is just linked to a client', done =>
        request('https://localhost:8080')
          .get('/roles/other-role')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) {
              return done(err)
            } else {
              res.body.should.have.property('name', 'other-role')
              res.body.should.have.property('clients')
              res.body.clients.length.should.be.exactly(1)
              const mapId = arr => arr.map(a => a._id)
              mapId(res.body.clients).should.containEql(`${client4._id}`)
              return done()
            }
          })
      )

      it('should respond with 404 Not Found if role does not exist', done =>
        request('https://localhost:8080')
          .get('/roles/nonexistent')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(404)
          .end((err, res) => done(err))
      )

      return it('should reject a request from a non root user', done =>
        request('https://localhost:8080')
          .get('/roles/role1')
          .set('auth-username', testUtils.nonRootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(403)
          .end((err, res) => done(err))
      )
    })

    describe('*addRole()', () => {
      it('should respond with 400 Bad Request if role already exists', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role1',
            channels: [{_id: `${channel2._id}`}]
          })
          .expect(400)
          .end((err, res) => done(err))
      )

      it('should add a role', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role4',
            channels: [
              {_id: `${channel1._id}`},

              {_id: `${channel2._id}`}
            ]
          })
          .expect(201)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role4']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(2)
              const mapChId = chns => chns.map(ch => `${ch._id}`)
              mapChId(channels).should.containEql(`${channel1._id}`)
              mapChId(channels).should.containEql(`${channel2._id}`)
              return done()
            })
          })
      )

      it('should add a role and update clients', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role4',
            channels: [
              {_id: `${channel1._id}`},

              {_id: `${channel2._id}`}
            ],
            clients: [
              {_id: `${client1._id}`},

              {_id: `${client2._id}`}
            ]
          })
          .expect(201)
          .end((err, res) => {
            if (err) { return done(err) }
            return ClientModelAPI.find({roles: {$in: ['role4']}}, (err, clients) => {
              if (err) { return done(err) }
              clients.length.should.be.exactly(2)
              const mapId = arr => arr.map(a => `${a._id}`)
              mapId(clients).should.containEql(`${client1._id}`)
              mapId(clients).should.containEql(`${client2._id}`)
              return done()
            })
          })
      )

      it('should add a role and update channels specified with either _id or name', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role4',
            channels: [
              {_id: `${channel1._id}`},

              {name: channel2.name}
            ]
          })
          .expect(201)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role4']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(2)
              const mapChId = chns => chns.map(ch => `${ch._id}`)
              mapChId(channels).should.containEql(`${channel1._id}`)
              mapChId(channels).should.containEql(`${channel2._id}`)
              return done()
            })
          })
      )

      it('should add a role and update clients specified with either _id or clientID', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role4',
            channels: [
              {_id: `${channel1._id}`},

              {_id: `${channel2._id}`}
            ],
            clients: [
              {_id: `${client1._id}`},

              {clientID: `${client2.clientID}`}
            ]
          })
          .expect(201)
          .end((err, res) => {
            if (err) { return done(err) }
            return ClientModelAPI.find({roles: {$in: ['role4']}}, (err, clients) => {
              if (err) { return done(err) }
              clients.length.should.be.exactly(2)
              const mapId = arr => arr.map(a => `${a._id}`)
              mapId(clients).should.containEql(`${client1._id}`)
              mapId(clients).should.containEql(`${client2._id}`)
              return done()
            })
          })
      )

      it('should respond with 400 Bad Request if name is not specified', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [
              {_id: `${channel1._id}`},

              {_id: `${channel2._id}`}
            ]
          })
          .expect(400)
          .end((err, res) => done(err))
      )

      it('should respond with 400 Bad Request if channels is empty', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role2',
            channels: []
          })
          .expect(400)
          .end((err, res) => done(err))
      )

      it('should respond with 400 Bad Request if channels and clients are not specified', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role2'
          })
          .expect(400)
          .end((err, res) => done(err))
      )

      it('should reject a request from a non root user', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.nonRootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role4',
            channels: [{_id: `${channel1._id}`}]
          })
          .expect(403)
          .end((err, res) => done(err))
      )

      it('should add a role for clients', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role4',
            clients: [
              {_id: `${client1._id}`},

              {_id: `${client2._id}`}
            ]
          })
          .expect(201)
          .end((err, res) => {
            if (err) { return done(err) }
            return ClientModelAPI.find({roles: {$in: ['role4']}}, (err, clients) => {
              if (err) { return done(err) }
              clients.length.should.be.exactly(2)
              const mapId = arr => arr.map(a => `${a._id}`)
              mapId(clients).should.containEql(`${client1._id}`)
              mapId(clients).should.containEql(`${client2._id}`)
              return done()
            })
          })
      )

      return it('should reject a role that conflicts with a clientID', done =>
        request('https://localhost:8080')
          .post('/roles')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'client1',
            channels: [{_id: `${channel1._id}`}]
          })
          .expect(409)
          .end((err, res) => done(err))
      )
    })

    describe('*updateRole()', () => {
      it('should respond with 400 Not Found if role doesn\'t exist', done =>
        request('https://localhost:8080')
          .put('/roles/role4')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [{_id: `${channel1._id}`}]
          })
          .expect(404)
          .end((err, res) => done(err))
      )

      it('should update a role (enable role1 on channel2 and remove from channel1)', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [{_id: `${channel2._id}`}]
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role1']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(1)
              const mapChId = chns => chns.map(ch => `${ch._id}`)
              mapChId(channels).should.containEql(`${channel2._id}`)
              return done()
            })
          })
      )

      it('should update a role (enable role1 for client2 and client3 and disable for client1)', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            clients: [
              {_id: `${client2._id}`},

              {_id: `${client3._id}`}
            ]
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ClientModelAPI.find({roles: {$in: ['role1']}}, (err, clients) => {
              if (err) { return done(err) }
              clients.length.should.be.exactly(2)
              const mapId = arr => arr.map(a => `${a._id}`)
              mapId(clients).should.containEql(`${client2._id}`)
              mapId(clients).should.containEql(`${client3._id}`)
              return done()
            })
          })
      )

      it('should update a role (enable role1 on both channel1 and channel2)', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [
              {_id: `${channel1._id}`},

              {_id: `${channel2._id}`}
            ]
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role1']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(2)
              const mapChId = chns => chns.map(ch => `${ch._id}`)
              mapChId(channels).should.containEql(`${channel1._id}`)
              mapChId(channels).should.containEql(`${channel2._id}`)
              return done()
            })
          })
      )

      it('should remove a role from all channels that is an update of an empty channel array', done =>
        request('https://localhost:8080')
          .put('/roles/role2')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: []
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role2']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(0)
              return done()
            })
          })
      )

      it('should not remove a role from clients if update contains empty channel array', done =>
        request('https://localhost:8080')
          .put('/roles/role2')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: []
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ClientModelAPI.find({roles: {$in: ['role2']}}, (err, clients) => {
              if (err) { return done(err) }
              clients.length.should.be.exactly(1)
              return done()
            })
          })
      )

      it('should remove a role from all channels and clients if update contains empty channel and clients arrays', done =>
        request('https://localhost:8080')
          .put('/roles/role2')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [],
            clients: []
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role2']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(0)
              return ClientModelAPI.find({roles: {$in: ['role2']}}, (err, clients) => {
                if (err) { return done(err) }
                clients.length.should.be.exactly(0)
                return done()
              })
            })
          })
      )

      it('should update a role using channel name', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [{name: channel2.name}]
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role1']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(1)
              const mapChId = chns => chns.map(ch => `${ch._id}`)
              mapChId(channels).should.containEql(`${channel2._id}`)
              return done()
            })
          })
      )

      it('should reject a request from a non root user', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.nonRootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [{_id: `${channel2._id}`}]
          })
          .expect(403)
          .end((err, res) => done(err))
      )

      it('should rename a role', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'the-new-role-name'
          })
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['the-new-role-name']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(1)
              const mapChId = chns => chns.map(ch => `${ch._id}`)
              mapChId(channels).should.containEql(`${channel1._id}`)
              return ClientModelAPI.find({roles: {$in: ['the-new-role-name']}}, (err, clients) => {
                if (err) { return done(err) }
                clients.length.should.be.exactly(2)
                const mapClId = cls => cls.map(cl => `${cl._id}`)
                mapClId(clients).should.containEql(`${client1._id}`)
                mapClId(clients).should.containEql(`${client3._id}`)
                return done()
              })
            })
          })
      )

      it('should reject a request to rename a role into an existing role name', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'role2'
          })
          .expect(400)
          .end((err, res) => done(err))
      )

      return it('should reject a role that conflicts with a clientID', done =>
        request('https://localhost:8080')
          .put('/roles/role1')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            name: 'client1'
          })
          .expect(409)
          .end((err, res) => done(err))
      )
    })

    return describe('*deleteRole()', () => {
      it('should respond with 404 Not Found if role doesn\'t exist', done =>
        request('https://localhost:8080')
          .put('/roles/role4')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .send({
            channels: [{_id: `${channel1._id}`}]
          })
          .expect(404)
          .end((err, res) => done(err))
      )

      it('should delete a role', done =>
        request('https://localhost:8080')
          .delete('/roles/role2')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ChannelModelAPI.find({allow: {$in: ['role2']}}, (err, channels) => {
              if (err) { return done(err) }
              channels.length.should.be.exactly(0)
              return ClientModelAPI.find({roles: {$in: ['role2']}}, (err, clients) => {
                if (err) { return done(err) }
                clients.length.should.be.exactly(0)
                return done()
              })
            })
          })
      )

      it('should delete a role that\'s only linked to a client', done =>
        request('https://localhost:8080')
          .delete('/roles/other-role')
          .set('auth-username', testUtils.rootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(200)
          .end((err, res) => {
            if (err) { return done(err) }
            return ClientModelAPI.find({roles: {$in: ['other-role']}}, (err, clients) => {
              if (err) { return done(err) }
              clients.length.should.be.exactly(0)
              return done()
            })
          })
      )

      return it('should reject a request from a non root user', done =>
        request('https://localhost:8080')
          .delete('/roles/role2')
          .set('auth-username', testUtils.nonRootUser.email)
          .set('auth-ts', authDetails.authTS)
          .set('auth-salt', authDetails.authSalt)
          .set('auth-token', authDetails.authToken)
          .expect(403)
          .end((err, res) => done(err))
      )
    })
  })
)
