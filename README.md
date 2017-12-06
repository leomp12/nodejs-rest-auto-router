# nodejs-rest-auto-router
Simple auto router for Node.js raw http designed for JSON RESTful API

<a href="https://www.npmjs.com/package/rest-auto-router" target="_blank">npm package</a>
```
npm install --save rest-auto-router
```

**Expect to receive requests from reverse proxy only**,
not recommended to use without proxy server such as Nginx, Apache Httpd, HAProxy, etc.

## Usage

```javascript
// test and example purpouse only

const conf = {
  // path to routes folder
  'path': process.cwd() + '/routes/',
  // listened tcp port
  // should be opened for localhost only
  'port': 8080,
  // part of the URL to be deleted in routing
  // like RewriteBase of Apache Httpd mod_rewrite
  'base_uri': '/v1/',
  // must be configured in common with proxy server
  'proxy': {
    // request timeout in ms
    'timeout': 30000,
    // X-Authentication header
    'auth': 'proxypassword'
  },
  // default error messages
  // used when messages are null
  'error_messages': {
    'dev': 'Unknow error',
    'usr': {
      'en_us': 'Unexpected error, report to support or responsible developer',
      'pt_br': 'Erro inesperado, reportar ao suporte ou desenvolvedor responsável'
    }
  },
  // allow clients to specify what fields to receive from resource
  // if true, response should vary by http param 'fields'
  'vary_fields': false
}

var restAutoRouter = require('./main.js')
restAutoRouter(conf)
```

### Routes

* Files on routes path (*conf.path*) should always end with **.js**
* Must export an object with available methods (HTTP verbs) for this API resource
* Each object property (method) should be a function with params *id, meta, body, respond*
* Files and directories started with . (dot) and # (hashtag) will be ignored

#### Route example

1. Filename: products.js
2. Route: products
3. URL served: api.example.com/v1/products.json
+ In the above example *conf.base_uri* = '/v1/'
+ Works without *.json* extension too

```javascript
function get (id, meta, body, respond, props) {
  if (id) {
    respond(id)
  } else {
    respond('Example')
  }
}

module.exports = {
  'GET': get
}
```

It's possible to define functions for
`GET`, `POST`, `PATCH`, `PUT` and `DELETE`
methods (HTTP verbs), `OPTIONS` will list available methods for the resource
and other methods will return 405 status code.

### Callback params

* `id` (string) is the resource ID at URL
* `meta` (object) is the metadata options defined by query string
    + `limit` (integer)
        - ?limit=100
        - `meta.limit = 100`
    + `offset` (integer)
        - ?offset=10
        - `meta.offset = 10`
    + `sort` (array)
        - ?sort=pop,-prc
        - `meta.sort = [{ field: 'pop', order: 1 }, { field: 'prc', order: -1 }]`
    + `fields` (array)
        - ?fields=id,price
        - `meta.fields = [ 'id', 'price' ]`
    + `query` (object)
        - ?any=1&other=2
* `body` (mixed) is the received request body
    + Body must be a valid JSON
    + Will be ignored on *GET*, *DELETE* and *OPTIONS* requests
* `respond` (function) is the function to respond the HTTP request
    + Function params:
        - `obj` (mixed)
        - `meta` (object)
        - `status` (integer) *default = 200*
        - `errorCode` (integer, string) *default = -1*
        - `devMsg` (string) *default = null*
        - `usrMsg` (string, object) *default = null*
        - `moreInfo` (string) *default = null*
* `props` (array) is the list of other *IDs* (properties, subresource IDs...) at URL

Eg.: */{resource}/{id}/{subresource}/{props[0]}.json?limit=100&offset=10&sort=pop,-prc&fields=id,price&any=1&other=2*

### Middleware

You can specify a function to be called before route:

```javascript
restAutoRouter(conf, middleware)
```

And a Console object (to log):

```javascript
restAutoRouter(conf, middleware, logger)
```

#### Middleware example:

```javascript
function middleware (id, meta, body, respond, req, res, resource, verb, endpoint) {
  // function called before endpoints
  // authentications and other prerequisites when necessary
  // logger.log(resource)
  if (typeof req.headers['x-real-ip'] === 'string') {
    let ip = req.headers['x-real-ip']
    let auth

    if (ip === '127.0.0.1') {
      // localhost authentication
      // all granted
      auth = true
    } else {
      // continue without authentication
      auth = false
    }

    // pass auth token header
    endpoint(id, meta, body, respond, auth, ip, req.headers['x-token'])
  } else {
    respond({}, null, 403, 100, 'Who are you? Unknown IP address')
  }
}
```
