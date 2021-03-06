'use strict';

const api = {};

api.gs = {};
api.fs = require('fs');
api.util = require('util');
api.events = require('events');
api.crypto = require('crypto');
api.mkdirp = require('mkdirp');

api.jstp = require('metarhia-jstp');
api.common = require('metarhia-common');
api.metasync = require('metasync');

require('./lib/provider')(api);
const gs = new api.gs.StorageProvider();
api.gs = gs;
module.exports = gs;

[ 'provider', 'provider.fs', 'provider.memory', 'provider.mongodb',
  'cursor', 'cursor.fs', 'cursor.memory', 'cursor.mongodb',
  'connection', 'category', 'transformations'
].forEach((name) => require('./lib/' + name)(api));

api.gs.NO_STORAGE = 'No storage provider available';
api.gs.NOT_IMPLEMENTED = 'Not implemented';

// Hash keyed by provider name
//
gs.providers = {
  fs: gs.FsProvider,
  memory: gs.MemoryProvider,
  mongodb: gs.MongodbProvider,
};

// Objects cache keyed by id
//
gs.memory = new gs.MemoryProvider();

// Database mode
//   closed - no one provider is available
//   offline - local storage provider is available
//   online - local and connections are available
//
gs.mode = 'closed';

// Local storage provider
// implementing interface globalStorageProvider
//
gs.local = null;

// Database opened
//
gs.active = false;

gs.open = (options, callback) => {
  gs.memory.open({ gs: options.gs }, () => {});
  const Provider = gs.providers[options.provider];
  if (Provider) {
    gs.local = new Provider();
    gs.active = true;
    gs.local.open(options, callback);
  } else {
    callback(new Error(api.gs.NO_STORAGE));
  }
};

// Remote storage provider
// implementing interface globalStorageProvider
//
gs.connections = {};

gs.connect = (
  // Connect to Global Storage server
  options, // connection parammeters
  // Example: { url: 'gs://user:password@host:port/database' }
  callback // on connect function(err, connection)
) => {
  const connection = new gs.Connection(options);
  callback(null, connection);
};

// Categories cache keyed by category name
//
gs.categories = {};

gs.category = (
  // Get Category
  name, // name of category
  callback // function(err, category)
) => {
  let cat = gs.categories[name];
  if (!cat) {
    cat = new gs.Category(name);
    gs.categories[name] = cat;
  }
  callback(null, cat);
};

gs.get = (id, callback) => {
  gs.memoryStorageProvider.get(id, (err, data) => {
    if (data) callback(null, data);
    else get(id, callback);
  });

  function get(id, callback) {
    if (gs.local) {
      gs.local.get(id, (err, data) => {
        if (!err) return callback(null, data);
        const sid = gs.findServer(id);
        const connection = gs.infrastructure.index[sid];
        connection.get(id, callback);
      });
    } else if (callback) {
      callback(new Error(api.gs.NO_STORAGE));
    }
  }
};

gs.create = (obj, callback) => {
  if (gs.local) {
    gs.local.create(obj, callback);
  } else if (callback) {
    callback(new Error(api.gs.NO_STORAGE));
  }
};

gs.update = (obj, callback) => {
  if (gs.local) {
    gs.local.update(obj, callback);
  } else if (callback) {
    callback(new Error(api.gs.NO_STORAGE));
  }
};

gs.delete = (id, callback) => {
  if (gs.local) {
    gs.local.delete(id, callback);
  } else if (callback) {
    callback(new Error(api.gs.NO_STORAGE));
  }
};

gs.select = (query, options, callback) => {
  if (gs.local) {
    return gs.local.select(query, options, callback);
  } else if (callback) {
    callback(new Error(api.gs.NO_STORAGE));
  }
};

gs.index = (def, callback) => {
  if (gs.local) {
    gs.local.index(def, callback);
  } else if (callback) {
    callback(new Error(api.gs.NO_STORAGE));
  }
};

// Global Storage Infrastructure
//
gs.infrastructure = {};

// Servers tree
//
gs.infrastructure.tree = {};

// Servers index
//
gs.infrastructure.index = [];

// Server bit mask
//
gs.infrastructure.mask = 0;

// Build index array from tree
//
function buildIndex(tree) {
  const result = [];
  const parseTree = (index, depth, node) => {
    const isBranch = !!node[0];
    if (isBranch) {
      parseTree(index, depth + 1, node[0]);
      parseTree(index + (1 << depth), depth + 1, node[1]);
    } else {
      result[index] = node;
    }
  };
  parseTree(0, 0, tree);

  const height = Math.ceil(Math.log(result.length) / Math.log(2));
  let i, j, depth;
  for (i = result.length; i >= 0; i--) {
    depth = Math.ceil(Math.log(i + 1) / Math.log(2));
    for (j = 1; result[i] && j < 1 << height - depth; j++) {
      if (!result[i + (j << depth)]) {
        result[i + (j << depth)] = result[i];
      }
    }
  }
  return result;
}

// Assign new infrastructure tree
//
gs.infrastructure.assign = (tree) => {
  gs.infrastructure.servers = tree;
  const index = buildIndex(tree);
  gs.infrastructure.index = index;
  gs.infrastructure.bits = Math.log(index.length) / Math.log(2);
  gs.infrastructure.mask = Math.pow(2, gs.infrastructure.bits) - 1;
};

// Get server for id
//
gs.findServer = (id) => (
  gs.infrastructure.index[id & gs.infrastructure.mask]
);

// Last id in storage
//
gs.nextId = 0;

// Get server for id
//
gs.generateId = () => gs.nextId++;
// This function not used now
