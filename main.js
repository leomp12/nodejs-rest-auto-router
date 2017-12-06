'use strict'

function httpTimeout (socket) {
  try {
    // console.log(socket)
    let req = socket.parser.incoming
    let res = socket._httpMessage

    let err = 'HTTP timeout at ' + req.url
    if (typeof logger === 'object') {
      logger.log('rest-api-module => ' + err)
    } else {
      console.log(err)
    }
    httpErrorHandling(res, 504, -2, 'Connection timeout', null, null)
  } catch (e) {
    // error (?)
    let err = new Error('Unexpected HTTP timeout')
    if (typeof logger === 'object') {
      logger.error(err)
      logger.error(e)
    } else {
      console.error(err)
      console.error(e)
    }

    // try to force connection end
    if (typeof socket._httpMessage !== 'undefined') {
      try {
        socket._httpMessage.end('Timeout')
      } catch (e) {
        err = new Error(socket._httpMessage)
        if (typeof logger === 'object') {
          logger.error(err)
        } else {
          console.error(err)
        }
      }
    }
  }
}

function autoRouter (dir, routes, prefix = '') {
  const fs = require('fs')
  // reads the directory to collect the .js files and to populate the routes object
  // do not change if deleting, renaming, or editing files
  let files = fs.readdirSync(dir)
  for (let i = 0; i < files.length; i++) {
    let file = files[i]
    // scapes files started with . (dot) and # (hashtag)
    let firstChar = file.charAt(0)
    if (firstChar === '.' || firstChar === '#') {
      continue
    }

    if (fs.statSync(dir + file).isDirectory()) {
      // directory
      // recursive function
      autoRouter(dir + file + '/', routes, prefix + file + '/')
    } else {
      // substr to remove extension (.js)
      routes[prefix + file.substr(0, file.length - 3)] = require(dir + file)
    }
  }
  return routes
}

function toUri (resource) {
  // insert _id indicating variable values
  let paths = resource.split('/')
  if (paths.length > 1) {
    // should receive ID on URI
    resource = paths[0] + '/_id/' + paths[1]
    for (let i = 2; i < paths.length; i++) {
      // subresource property
      resource += '/_id/' + paths[i]
    }
  }
  return conf.base_uri + resource + '.json'
}

function routing (req, res, body = {}) {
  // verify proxy with authentication header
  if (typeof req.headers['x-authentication'] === 'undefined') {
    httpErrorHandling(res, 407, 10, 'Proxy authentication required', null, null)
    return
  } else if (req.headers['x-authentication'] !== conf.proxy.auth) {
    httpErrorHandling(res, 401, 11, 'Unauthorized', null, null)
    return
  }

  let urlObj = url.parse(req.url)
  // separate pathname -> /v1/products
  // remove the base uri and .json extension and use lowercase letters
  let regex = new RegExp('^(' + conf.base_uri + ')', 'i')
  let uri = urlObj.pathname
  if (uri.match(regex) === null) {
    let devMsg = 'Could not match the base URI, maybe you have not specified the API version'
    httpErrorHandling(res, 400, 19, devMsg, null, null)
    return
  }
  uri = uri.replace(regex, '').replace('.json', '').toLowerCase()
  // http querystring to object
  let params = querystring.parse(urlObj.query)
  /*
  Note: The object returned by the querystring.parse() method does not prototypically inherit
  from the JavaScript Object. This means that typical Object methods such as obj.toString(),
  obj.hasOwnProperty(), and others are not defined and will not work.
  https://nodejs.org/api/querystring.html
  */

  // ref.: https://github.com/WhiteHouse/api-standards#good-url-examples
  let paths = uri.split('/')
  // main resource should always be after base uri
  // ex.: /v1/products -> products
  let resource, id
  // array of subresources (properties) IDs
  let props = []
  switch (paths.length) {
    case 1:
      // directly on resource
      resource = paths[0]
      break

    case 2:
      // specific element of resource by ID
      // ex.: /v1/products/abc123 -> products
      [ resource, id ] = paths
      break

    default:
      // at least one subresource
      // subresource (property) of specific element of resource by ID
      // ex.: /v1/products/123/attributes[/abc/attribute...]
      [ resource, id ] = paths
      for (let i = 2; i < paths.length; i++) {
        if (i % 2 === 0) {
          resource += '/' + paths[i]
        } else {
          props.push(paths[i])
        }
      }
  }

  // final routing
  // find the property on routes referring to resource
  if (!routes.hasOwnProperty(resource)) {
    if (resource === '') {
      // index
      res.writeHead(202)
      // return array of resources
      let slugs = []
      for (let resource in routes) {
        if (routes.hasOwnProperty(resource)) {
          slugs.push(toUri(resource))
        }
      }
      res.end(JSON.stringify({ 'resources': slugs }))
      return
    } else {
      // return list of available main resources
      let devMsg = 'Not found, check the requested resource on URI\nAvailable resources:'
      for (let resource in routes) {
        if (routes.hasOwnProperty(resource)) {
          devMsg += ' /' + resource + '.json'
        }
      }
      httpErrorHandling(res, 404, 20, devMsg, null, null)
      return
    }
  }

  if (typeof id !== 'undefined' && id === '') {
    let devMsg = 'Precondition failed, resource is OK, but provided ID is invalid (null)'
    httpErrorHandling(res, 412, 25, devMsg, null, null)
    return
  }
  let verb = req.method
  let endpoint = routes[resource][verb]

  if (typeof endpoint === 'function') {
    // respond client and close request
    let respond = function (obj, meta, status = 200, errorCode = -1, devMsg = null, usrMsg = null, moreInfo = null) {
      if (res.finished) {
        // request ended
        return
      }

      // ref.: https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
      if (status < 300) {
        // OK
        // respond client and close request
        let body
        switch (typeof obj) {
          case 'object':
            // expected
            if (meta) {
              res.setHeader('X-Metadata', 'true')
              body = JSON.stringify({ 'meta': meta, 'result': obj })
            } else {
              body = JSON.stringify(obj)
            }
            break

          case 'string':
          case 'number':
            // maybe an ID returned after modification request
            body = JSON.stringify({ 'result': obj })
            break

          default:
            // return null JSON object
            body = '{}'
        }

        if (verb === 'GET') {
          // ETag to verify browser cache validation
          // have to be set here, web servers will not etag proxy requests
          // Cloudflare keep only weak ETags
          res.setHeader('ETag', etag(body, { 'weak': true }))
        }
        res.writeHead(status)
        res.end(body)
      } else if (status < 400 && typeof obj === 'string') {
        // redirect
        // expect obj to be the redirect URL
        // return object with previous and next (after redirect) URL
        let response = {
          'status': status,
          'requested_url': req.url,
          'endpoint': obj
        }
        // explain type of redirect in message
        if (status === 301) {
          response.message = 'Moved permanently, please re-send this request to the specified endpoint'
        } else {
          response.message = 'Temporary redirect, re-send this request to the specified temporary endpoint, ' +
            'continue to use the original request endpoint for future requests'
        }

        res.writeHead(status, { 'Location': obj })
        res.end(JSON.stringify(response))
      } else {
        // client and/or server error
        httpErrorHandling(res, status, errorCode, devMsg, usrMsg, moreInfo)
      }
    }

    // querystring params
    let meta = {}
    // limit number of results
    meta.limit = null
    if (typeof params.limit !== 'undefined') {
      // limit=100
      if (typeof params.limit === 'string') {
        meta.limit = parseInt(params.limit, 10)
        if (isNaN(meta.limit)) {
          meta.limit = null
        }
      }

      // delete to not put on query fields
      delete params.limit
    }

    // start on element number {offset}
    meta.offset = null
    if (typeof params.offset !== 'undefined') {
      // offset=0
      if (typeof params.offset === 'string') {
        meta.offset = parseInt(params.offset, 10)
        if (isNaN(meta.offset)) {
          meta.offset = null
        }
      }

      // delete to not put on query fields
      delete params.offset
    }

    // sorting resources
    meta.sort = []
    if (typeof params.sort !== 'undefined') {
      // sort=status,-name
      if (typeof params.sort === 'string') {
        let fieldsArrays = params.sort.split(',')
        for (let i = 0; i < fieldsArrays.length; i++) {
          if (fieldsArrays[i] != null) {
            let field, order
            if (fieldsArrays[i].charAt(0) === '-') {
              field = fieldsArrays[i].substr(1)
              order = -1
            } else {
              field = fieldsArrays[i]
              order = 1
            }

            // check if there is no repeating field
            for (let i = 0; i < meta.sort.length; i++) {
              if (meta.sort[i].field === field) {
                field = null
              }
            }
            if (field != null) {
              meta.sort.push({ field, order })
            }
          }
        }
      }

      // delete to not put on query fields
      delete params.sort
    }

    if (conf.vary_fields) {
      // especify fields to select and return
      meta.fields = []
      if (typeof params.fields !== 'undefined') {
        // fields=title,subtitle,date
        if (typeof params.fields === 'string') {
          let fieldsArrays = params.fields.split(',')
          for (let i = 0; i < fieldsArrays.length; i++) {
            let field = fieldsArrays[i]
            if (field != null) {
              // check if there is no repeating field
              for (let i = 0; i < meta.fields.length; i++) {
                if (meta.fields[i] === field) {
                  field = null
                }
              }
              if (field != null) {
                meta.fields.push(field)
              }
            }
          }
        }

        // delete to not put on query fields
        delete params.fields
      }
    }

    // query by fields (properties)
    // rest of query params should be properties of resource
    meta.query = {}
    for (let field in params) {
      if (typeof params[field] === 'string' && params[field] != null) {
        meta.query[field] = params[field]
      }
    }

    if (typeof middleware === 'function') {
      middleware(id, meta, body, respond, req, res, resource, verb, endpoint, props)
    } else {
      endpoint(id, meta, body, respond, props)
    }
  } else if (verb === 'OPTIONS') {
    // return available HTTP verbs (methods) for this resource
    res.writeHead(200)
    if (id) {
      // check if requested resource/subresource
      // id as subresource
      if (routes.hasOwnProperty(resource + '/' + id)) {
        resource = resource + '/' + id
      }
    }
    let route = routes[resource]
    let response = {
      'available_verbs': []
    }

    // check subresources
    let subresources = []
    for (let slug in routes) {
      if (routes.hasOwnProperty(slug) && slug.startsWith(resource + '/')) {
        subresources.push(toUri(slug))
      }
    }
    if (subresources.length) {
      response.subresources = subresources
    }

    for (let verb in route) {
      if (route.hasOwnProperty(verb)) {
        response.available_verbs.push(verb)
      }
    }
    res.end(JSON.stringify(response))
  } else {
    let devMsg = 'URL OK, but requested method is not allowed, try OPTIONS to see available verbs to this resource'
    httpErrorHandling(res, 405, 29, devMsg, null, null)
  }
}

function httpErrorHandling (res, statusCode, errorCode, devMsg, usrMsg, moreInfo) {
  // ref.: https://github.com/WhiteHouse/api-standards#error-handling
  if (devMsg == null) {
    switch (statusCode) {
      case 401:
        devMsg = 'Unauthorized'
        break

      case 404:
        devMsg = 'Not found'
        break

      case 400:
        devMsg = 'Bad request'
        break

      case 500:
        devMsg = 'Internal server error'
        break

      default:
        if (conf.error_messages.dev != null) {
          devMsg = conf.error_messages.dev
        }
    }
  }
  if (usrMsg == null) {
    switch (statusCode) {
      case 401:
        usrMsg = {
          'en_us': 'No authorization for the requested resource',
          'pt_br': 'Sem autorização para o recurso solicitado'
        }
        break

      case 404:
        usrMsg = {
          'en_us': 'No results were found for the requested resource and ID',
          'pt_br': 'Nenhum resultado foi encontrado para o recurso e ID solicitado'
        }
        break

      default:
        if (conf.error_messages.usr != null) {
          usrMsg = conf.error_messages.usr
        }
    }
  }

  let err = {
    'status': statusCode,
    'error_code': errorCode,
    // general purpose message
    // usually destinated to developers
    'message': devMsg,
    // optional message to end user
    // can be an object or array with multiple messages (one per language)
    'user_message': usrMsg,
    // optional string for more info
    // usually links to doc pages
    'more_info': moreInfo
  }
  res.writeHead(statusCode)
  res.end(JSON.stringify(err))
}

function httpServer (req, res) {
  // ref.: https://nodejs.org/en/docs/guides/anatomy-of-an-http-transaction/
  // https://nodejs.org/dist/latest-v8.x/docs/api/http.html
  // JSON RESTful
  // respond always with JSON
  res.setHeader('Content-Type', 'application/json, charset=utf-8')

  // mount body before routing
  let body = []
  let error = false

  req.on('error', (err) => {
    let devMsg = 'Bad request\n' + err.message + '\n' + err.stack
    httpErrorHandling(res, 400, 0, devMsg, null, null)
    error = true
  })

  .on('data', (chunk) => {
    body.push(chunk)
  })

  .on('end', () => {
    if (!error) {
      switch (req.method) {
        case 'GET':
        case 'DELETE':
        case 'OPTIONS':
          // discard body if received
          body = null
          break

        case 'POST':
        case 'PUT':
        case 'PATCH':
          if (body.length) {
            try {
              body = JSON.parse(Buffer.concat(body).toString('utf8'))
            } catch (e) {
              // invalid body
              // body = {}
              let devMsg = 'Not acceptable, body content must be a valid JSON with UTF-8 charset'
              httpErrorHandling(res, 406, 1, devMsg, null, null)
              return
            }
          } else {
            let devMsg = 'Empty body received, not acceptable for this request method, try using GET'
            httpErrorHandling(res, 406, 2, devMsg, null, null)
            return
          }
          break

        default:
          httpErrorHandling(res, 405, 6, 'Method not allowed (unknow method)', null, null)
          return
      }

      // request OK
      // start routing
      routing(req, res, body)
    }
  })
}

var routes, conf, middleware, logger

module.exports = function (_conf, _middleware, _logger) {
  /*
  _conf = {
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
  */

  // only _conf is required
  conf = _conf
  // _middleware may be a function to run just before terminating routing
  middleware = _middleware
  // _logger will replace the console (can be used for logs to files)
  logger = _logger
  // fill in routes
  routes = autoRouter(conf.path, {})
  // console.log(routes, 'routes')

  // start web server
  let http = require('http')
  let server = http.createServer(httpServer)
  server.listen(conf.port)
  server.setTimeout(conf.proxy.timeout, httpTimeout)
}

// used to process URL params
const url = require('url')
const querystring = require('querystring')
// create simple HTTP ETags
// https://www.npmjs.com/package/etag
const etag = require('etag')
