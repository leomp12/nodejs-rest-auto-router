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
