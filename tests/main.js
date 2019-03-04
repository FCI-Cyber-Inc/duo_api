/* global describe it beforeEach afterEach */
var assert = require('assert')
var nock = require('nock')
var sinon = require('sinon')
var duo_api = require('../lib/main.js')
var duo_sig = require('../lib/duo_sig')

var IKEY = 'DIXXXXXXXXXXXXXXXXXX'
var SKEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
var API_HOSTNAME = 'api_hostname'

describe('Verifying rate limited request retries', function () {
  var MAX_RANDOM_OFFSET = 1000
  var BACKOFF_FACTOR = 2
  var OK_RESP_CODE = 200
  var RATE_LIMITED_RESP_CODE = 429
  var clock
  var client

  beforeEach(function () {
    clock = sinon.useFakeTimers()
    client = new duo_api.Client(IKEY, SKEY, API_HOSTNAME)
  })

  afterEach(function () {
    clock.restore()
  })

  function addRequests (statusCode, numRequests = 1) {
    var stat = statusCode === OK_RESP_CODE ? 'OK' : 'FAIL'
    var date = new Date().toUTCString()
    var path = '/foo/bar'
    var sig = duo_sig.sign(
      client.ikey, client.skey, 'GET', client.host, path, {}, date, client.sig_version, client.digestmod)
    var scope = nock('https://' + API_HOSTNAME, {
      reqheaders: {
        'Date': date,
        'Host': API_HOSTNAME,
        'Authorization': sig
      }
    })
    scope.get(path)
      .times(numRequests)
      .reply(statusCode, {'response': {foo: 'bar'}, stat})
    return scope
  }

  it('verify does not sleep on ok resp', function (done) {
    addRequests(OK_RESP_CODE)
    client.jsonApiCall('GET', '/foo/bar', {}, function (resp) {
      assert.equal(resp.stat, 'OK')
      done()
    })
  })

  it('verify single rate limited response', function (done) {
    let currentWaitSecs = 1000
    var rateLimitedScope = addRequests(RATE_LIMITED_RESP_CODE)
    addRequests(OK_RESP_CODE)
    client.jsonApiCall('GET', '/foo/bar', {}, function (resp) {
      assert.equal(resp.stat, 'OK')
      done()
    })

    // Don't tick the clock until after the request has been replied to,
    // otherwise we'll move the clock forward before adding the retry attempt
    // via setTimeout.
    rateLimitedScope.on('replied', function (req, interceptor) {
      clock.tick(currentWaitSecs + MAX_RANDOM_OFFSET)
    })
    console.log('added emitter')
  })

  it('verify all rate limited responses', function (done) {
    var currentWaitSecs = 1000
    var scope = addRequests(RATE_LIMITED_RESP_CODE, 7)

    client.jsonApiCall('GET', '/foo/bar', {}, function (resp) {
      assert.equal(resp.stat, 'FAIL')
      done()
    })

    // Don't tick the clock until after the request has been replied to,
    // otherwise we'll move the clock forward before adding the retry attempt
    // via setTimeout.
    scope.on('replied', function (req, interceptor) {
      clock.tick(currentWaitSecs + MAX_RANDOM_OFFSET)
      currentWaitSecs = currentWaitSecs * BACKOFF_FACTOR
    })
  })
})
