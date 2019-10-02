// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = function(status, toThrow) {
  throw toThrow;
};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_HAS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
// A web environment like Electron.js can have Node enabled, so we must
// distinguish between Node-enabled environments and Node environments per se.
// This will allow the former to do things like mount NODEFS.
// Extended check using process.versions fixes issue #8816.
// (Also makes redundant the original check that 'require' is a function.)
ENVIRONMENT_HAS_NODE = typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string';
ENVIRONMENT_IS_NODE = ENVIRONMENT_HAS_NODE && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;



// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)




// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var read_,
    readAsync,
    readBinary,
    setWindowTitle;

if (ENVIRONMENT_IS_NODE) {
  scriptDirectory = __dirname + '/';

  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  var nodeFS;
  var nodePath;

  read_ = function shell_read(filename, binary) {
    var ret;
    ret = tryParseAsDataURI(filename);
    if (!ret) {
      if (!nodeFS) nodeFS = require('fs');
      if (!nodePath) nodePath = require('path');
      filename = nodePath['normalize'](filename);
      ret = nodeFS['readFileSync'](filename);
    }
    return binary ? ret : ret.toString();
  };

  readBinary = function readBinary(filename) {
    var ret = read_(filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  if (process['argv'].length > 1) {
    thisProgram = process['argv'][1].replace(/\\/g, '/');
  }

  arguments_ = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  process['on']('unhandledRejection', abort);

  quit_ = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    read_ = function shell_read(f) {
      var data = tryParseAsDataURI(f);
      if (data) {
        return intArrayToString(data);
      }
      return read(f);
    };
  }

  readBinary = function readBinary(f) {
    var data;
    data = tryParseAsDataURI(f);
    if (data) {
      return data;
    }
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    arguments_ = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    arguments_ = arguments;
  }

  if (typeof quit === 'function') {
    quit_ = function(status) {
      quit(status);
    };
  }

  if (typeof print !== 'undefined') {
    // Prefer to use print/printErr where they exist, as they usually work better.
    if (typeof console === 'undefined') console = {};
    console.log = print;
    console.warn = console.error = typeof printErr !== 'undefined' ? printErr : print;
  }
} else
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  read_ = function shell_read(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    } catch (err) {
      var data = tryParseAsDataURI(url);
      if (data) {
        return intArrayToString(data);
      }
      throw err;
    }
  };

  if (ENVIRONMENT_IS_WORKER) {
    readBinary = function readBinary(url) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
      } catch (err) {
        var data = tryParseAsDataURI(url);
        if (data) {
          return data;
        }
        throw err;
      }
    };
  }

  readAsync = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      var data = tryParseAsDataURI(url);
      if (data) {
        onload(data.buffer);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  setWindowTitle = function(title) { document.title = title };
} else
{
}

// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
var out = Module['print'] || console.log.bind(console);
var err = Module['printErr'] || console.warn.bind(console);

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module['arguments']) arguments_ = Module['arguments'];
if (Module['thisProgram']) thisProgram = Module['thisProgram'];
if (Module['quit']) quit_ = Module['quit'];

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message

// TODO remove when SDL2 is fixed (also see above)



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;


function dynamicAlloc(size) {
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end > _emscripten_get_heap_size()) {
    abort();
  }
  HEAP32[DYNAMICTOP_PTR>>2] = end;
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}

var asm2wasmImports = { // special asm2wasm imports
    "f64-rem": function(x, y) {
        return x % y;
    },
    "debugger": function() {
    }
};



var jsCallStartIndex = 1;
var functionPointers = new Array(0);

// Wraps a JS function as a wasm function with a given signature.
// In the future, we may get a WebAssembly.Function constructor. Until then,
// we create a wasm module that takes the JS function as an import with a given
// signature, and re-exports that as a wasm function.
function convertJsFunctionToWasm(func, sig) {

  // The module is static, with the exception of the type section, which is
  // generated based on the signature passed in.
  var typeSection = [
    0x01, // id: section,
    0x00, // length: 0 (placeholder)
    0x01, // count: 1
    0x60, // form: func
  ];
  var sigRet = sig.slice(0, 1);
  var sigParam = sig.slice(1);
  var typeCodes = {
    'i': 0x7f, // i32
    'j': 0x7e, // i64
    'f': 0x7d, // f32
    'd': 0x7c, // f64
  };

  // Parameters, length + signatures
  typeSection.push(sigParam.length);
  for (var i = 0; i < sigParam.length; ++i) {
    typeSection.push(typeCodes[sigParam[i]]);
  }

  // Return values, length + signatures
  // With no multi-return in MVP, either 0 (void) or 1 (anything else)
  if (sigRet == 'v') {
    typeSection.push(0x00);
  } else {
    typeSection = typeSection.concat([0x01, typeCodes[sigRet]]);
  }

  // Write the overall length of the type section back into the section header
  // (excepting the 2 bytes for the section id and length)
  typeSection[1] = typeSection.length - 2;

  // Rest of the module is static
  var bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic ("\0asm")
    0x01, 0x00, 0x00, 0x00, // version: 1
  ].concat(typeSection, [
    0x02, 0x07, // import section
      // (import "e" "f" (func 0 (type 0)))
      0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
    0x07, 0x05, // export section
      // (export "f" (func 0 (type 0)))
      0x01, 0x01, 0x66, 0x00, 0x00,
  ]));

   // We can compile this wasm module synchronously because it is very small.
  // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
  var module = new WebAssembly.Module(bytes);
  var instance = new WebAssembly.Instance(module, {
    e: {
      f: func
    }
  });
  var wrappedFunc = instance.exports.f;
  return wrappedFunc;
}

// Add a wasm function to the table.
function addFunctionWasm(func, sig) {
  var table = wasmTable;
  var ret = table.length;

  // Grow the table
  try {
    table.grow(1);
  } catch (err) {
    if (!err instanceof RangeError) {
      throw err;
    }
    throw 'Unable to grow wasm table. Use a higher value for RESERVED_FUNCTION_POINTERS or set ALLOW_TABLE_GROWTH.';
  }

  // Insert new element
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    table.set(ret, func);
  } catch (err) {
    if (!err instanceof TypeError) {
      throw err;
    }
    assert(typeof sig !== 'undefined', 'Missing signature argument to addFunction');
    var wrapped = convertJsFunctionToWasm(func, sig);
    table.set(ret, wrapped);
  }

  return ret;
}

function removeFunctionWasm(index) {
  // TODO(sbc): Look into implementing this to allow re-using of table slots
}

// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {


  var base = 0;
  for (var i = base; i < base + 0; i++) {
    if (!functionPointers[i]) {
      functionPointers[i] = func;
      return jsCallStartIndex + i;
    }
  }
  throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';

}

function removeFunction(index) {

  functionPointers[index-jsCallStartIndex] = null;
}

var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
};

var getTempRet0 = function() {
  return tempRet0;
};


var Runtime = {
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;




// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html


var wasmBinary;if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];
var noExitRuntime;if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];


if (typeof WebAssembly !== 'object') {
  err('no native wasm support detected');
}


// In MINIMAL_RUNTIME, setValue() and getValue() are only available when building with safe heap enabled, for heap safety checking.
// In traditional runtime, setValue() and getValue() are always available (although their use is highly discouraged due to perf penalties)

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}





// Wasm globals

var wasmMemory;

// Potentially used for direct table calls.
var wasmTable;


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);

  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  argTypes = argTypes || [];
  // When the function takes numbers and returns a number, we can just return
  // the original function
  var numericArgs = argTypes.every(function(type){ return type === 'number'});
  var numericRet = returnType !== 'string';
  if (numericRet && numericArgs && !opts) {
    return getCFunc(ident);
  }
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}




/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  abort("this function has been removed - you should use UTF8ToString(ptr, maxBytesToRead) instead!");
}

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}


// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}


// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}




// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferAndViews(buf) {
  buffer = buf;
  Module['HEAP8'] = HEAP8 = new Int8Array(buf);
  Module['HEAP16'] = HEAP16 = new Int16Array(buf);
  Module['HEAP32'] = HEAP32 = new Int32Array(buf);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buf);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buf);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buf);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buf);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buf);
}


var STATIC_BASE = 1024,
    STACK_BASE = 5392,
    STACKTOP = STACK_BASE,
    STACK_MAX = 5248272,
    DYNAMIC_BASE = 5248272,
    DYNAMICTOP_PTR = 5360;




var TOTAL_STACK = 5242880;

var INITIAL_TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;








  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory'];
  } else
  {
    wasmMemory = new WebAssembly.Memory({
      'initial': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE
      ,
      'maximum': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE
    });
  }


if (wasmMemory) {
  buffer = wasmMemory.buffer;
}

// If the user provides an incorrect length, just use that length instead rather than providing the user to
// specifically provide the memory length with Module['TOTAL_MEMORY'].
INITIAL_TOTAL_MEMORY = buffer.byteLength;
updateGlobalBufferAndViews(buffer);

HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;









function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {

  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  runtimeInitialized = true;
  
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  runtimeExited = true;
}

function postRun() {

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}



var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled

function getUniqueRunDependency(id) {
  return id;
}

function addRunDependency(id) {
  runDependencies++;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

}

function removeRunDependency(id) {
  runDependencies--;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data


var memoryInitializer = null;







// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'data:application/octet-stream;base64,AGFzbQEAAAABbg9gAX8Bf2AEf39/fwBgAABgBn9/f39/fwBgBX9/f39/AGADf39/AX9gAn9/AX9gAX8AYAABf2ANf39/f39/f39/f39/fwBgCH9/f39/f39/AGACf38AYAN/f38AYAR/f39/AX9gB39/f39/f38AAvMEFgNlbnYFYWJvcnQABwNlbnYaX19fY3hhX3VuY2F1Z2h0X2V4Y2VwdGlvbnMACANlbnYLX19fc2V0RXJyTm8ABwNlbnYWX19lbWJpbmRfcmVnaXN0ZXJfYm9vbAAEA2VudhdfX2VtYmluZF9yZWdpc3Rlcl9jbGFzcwAJA2VudiNfX2VtYmluZF9yZWdpc3Rlcl9jbGFzc19jb25zdHJ1Y3RvcgADA2VudiBfX2VtYmluZF9yZWdpc3Rlcl9jbGFzc19mdW5jdGlvbgAKA2VudhdfX2VtYmluZF9yZWdpc3Rlcl9lbXZhbAALA2VudhdfX2VtYmluZF9yZWdpc3Rlcl9mbG9hdAAMA2VudhlfX2VtYmluZF9yZWdpc3Rlcl9pbnRlZ2VyAAQDZW52HV9fZW1iaW5kX3JlZ2lzdGVyX21lbW9yeV92aWV3AAwDZW52HF9fZW1iaW5kX3JlZ2lzdGVyX3N0ZF9zdHJpbmcACwNlbnYdX19lbWJpbmRfcmVnaXN0ZXJfc3RkX3dzdHJpbmcADANlbnYWX19lbWJpbmRfcmVnaXN0ZXJfdm9pZAALA2VudhlfZW1zY3JpcHRlbl9nZXRfaGVhcF9zaXplAAgDZW52Fl9lbXNjcmlwdGVuX21lbWNweV9iaWcABQNlbnYXX2Vtc2NyaXB0ZW5fcmVzaXplX2hlYXAAAANlbnYXYWJvcnRPbkNhbm5vdEdyb3dNZW1vcnkAAANlbnYMX190YWJsZV9iYXNlA38AA2Vudg5EWU5BTUlDVE9QX1BUUgN/AANlbnYGbWVtb3J5AgGAAoACA2VudgV0YWJsZQFwAS8vA78BvQECAAgHCwIHAQIACAcICAgACAgICAgIAAcGAAAAAAgICwsEAAAACAgCCAYAAAICBwIICAcHBwcHBwcHBwcHCAgICAcHBwcHBwcHBwcHBwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAgIAAcABwcH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Qc8TEFlB8RMQXEGQFBBdQbAUEF4LBQAQmQELBQAQmAELLAEBfyMCIQEjAkEQaiQCIAEgADYCABCWASABKAIAQQFBgH9B/wAQCSABJAILLAEBfyMCIQEjAkEQaiQCIAEgADYCABCUASABKAIAQQFBgH9B/wAQCSABJAILKwEBfyMCIQEjAkEQaiQCIAEgADYCABCSASABKAIAQQFBAEH/ARAJIAEkAgsuAQF/IwIhASMCQRBqJAIgASAANgIAEJABIAEoAgBBAkGAgH5B//8BEAkgASQCCywBAX8jAiEBIwJBEGokAiABIAA2AgAQjgEgASgCAEECQQBB//8DEAkgASQCCzIBAX8jAiEBIwJBEGokAiABIAA2AgAQjAEgASgCAEEEQYCAgIB4Qf////8HEAkgASQCCyoBAX8jAiEBIwJBEGokAiABIAA2AgAQigEgASgCAEEEQQBBfxAJIAEkAgsyAQF/IwIhASMCQRBqJAIgASAANgIAEIgBIAEoAgBBBEGAgICAeEH/////BxAJIAEkAgsqAQF/IwIhASMCQRBqJAIgASAANgIAEIYBIAEoAgBBBEEAQX8QCSABJAILJgEBfyMCIQEjAkEQaiQCIAEgADYCABCEASABKAIAQQQQCCABJAILJgEBfyMCIQEjAkEQaiQCIAEgADYCABCCASABKAIAQQgQCCABJAILBQAQgQELBQAQgAELBAAQfwsEABB+CyUBAX8jAiEBIwJBEGokAiABIAA2AgAQfBAcIAEoAgAQCiABJAILJQEBfyMCIQEjAkEQaiQCIAEgADYCABB6EBwgASgCABAKIAEkAgslAQF/IwIhASMCQRBqJAIgASAANgIAEHcQeCABKAIAEAogASQCCyUBAX8jAiEBIwJBEGokAiABIAA2AgAQdBB1IAEoAgAQCiABJAILJQEBfyMCIQEjAkEQaiQCIAEgADYCABBxEHIgASgCABAKIAEkAgslAQF/IwIhASMCQRBqJAIgASAANgIAEG8QayABKAIAEAogASQCCyUBAX8jAiEBIwJBEGokAiABIAA2AgAQbRBoIAEoAgAQCiABJAILJQEBfyMCIQEjAkEQaiQCIAEgADYCABBqEGsgASgCABAKIAEkAgslAQF/IwIhASMCQRBqJAIgASAANgIAEGcQaCABKAIAEAogASQCCyUBAX8jAiEBIwJB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ACABQQAQsQEEQEEBIAIoAgAiAEUNARogAiAAKAIANgIAQQEMAQsgAQR/IAFBkApByApBABCrASIBBH8gAigCACIEBEAgAiAEKAIANgIACyABQQhqKAIAIgVBB3EgAEEIaiIEKAIAIgZBB3NxBH9BAAUgBiAFQeAAcUHgAHNxBH9BAAUgAEEMaiIFKAIAIgAgAUEMaiIBKAIAIgZBABCnAQR/QQEFIABBiAtBABCnAQRAQQEgBkUNBhogBkGQCkHYCkEAEKsBRQwGCyAABH8gAEGQCkHICkEAEKsBIgAEQEEAIAQoAgBBAXFFDQcaIAAgASgCABCyAQwHCyAFKAIAIgAEfyAAQZAKQegKQQAQqwEiAARAQQAgBCgCAEEBcUUNCBogACABKAIAELMBDAgLIAUoAgAiAAR/IABBkApBgApBABCrASIABH8gASgCACIBBH8gAUGQCkGACkEAEKsBIgEEfyADIAE2AgAgA0EEakEANgIAIANBCGogADYCACADQQxqQX82AgAgA0EQaiIAQgA3AgAgAEIANwIIIABCADcCECAAQgA3AhggAEEANgIgIABBADsBJCAAQQA6ACYgA0EwakEBNgIAIAEoAgBBHGooAgAhBCABIAMgAigCAEEBIARBB3FBG2oRAQAgA0EYaigCAEEBRgR/An9BASACKAIARQ0AGiACIAAoAgA2AgBBAQsFQQALBUEACwVBAAsFQQALBUEACwVBAAsFQQALCwsLBUEACwVBAAsLCyEAIAckAiAAC1cAAn8CQCAAQQhqKAIAQRhxBH9BASECDAEFIAEEfyABQZAKQbgKQQAQqwEiAgR/IAJBCGooAgBBGHFBAEchAgwDBUEACwVBAAsLDAELIAAgASACEKcBCwvYAQECfwJAAkADQAJAIAFFBEBBACEADAELIAFBkApByApBABCrASIBRQRAQQAhAAwBCyABQQhqKAIAIABBCGooAgAiAkF/c3EEQEEAIQAMAQsgAEEMaiIDKAIAIgAgAUEMaiIBKAIAQQAQpwEEQEEBIQAMAQsgAEUgAkEBcUVyBEBBACEADAELIABBkApByApBABCrASIARQ0CIAEoAgAhAQwBCwsMAQsgAygCACIABH8gAEGQCkHoCkEAEKsBIgAEfyAAIAEoAgAQswEFQQALBUEACyEACyAAC2kAIAEEfyABQZAKQegK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bnNpZ25lZCBjaGFyAHNob3J0AHVuc2lnbmVkIHNob3J0AGludAB1bnNpZ25lZCBpbnQAbG9uZwB1bnNpZ25lZCBsb25nAGZsb2F0AGRvdWJsZQBzdGQ6OnN0cmluZwBzdGQ6OmJhc2ljX3N0cmluZzx1bnNpZ25lZCBjaGFyPgBzdGQ6OndzdHJpbmcAZW1zY3JpcHRlbjo6dmFsAGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGNoYXI+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHNpZ25lZCBjaGFyPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1bnNpZ25lZCBjaGFyPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxzaG9ydD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8dW5zaWduZWQgc2hvcnQ+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGludD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8dW5zaWduZWQgaW50PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxsb25nPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1bnNpZ25lZCBsb25nPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxpbnQ4X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHVpbnQ4X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGludDE2X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHVpbnQxNl90PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxpbnQzMl90PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1aW50MzJfdD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8ZmxvYXQ+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGRvdWJsZT4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8bG9uZyBkb3VibGU+AE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWVFRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lkRUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJZkVFAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SW1FRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lsRUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJakVFAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWlFRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0l0RUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJc0VFAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWhFRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lhRUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJY0VFAE4xMGVtc2NyaXB0ZW4zdmFsRQBOU3QzX18yMTJiYXNpY19zdHJpbmdJd05TXzExY2hhcl90cmFpdHNJd0VFTlNfOWFsbG9jYXRvckl3RUVFRQBOU3QzX18yMjFfX2Jhc2ljX3N0cmluZ19jb21tb25JTGIxRUVFAE5TdDNfXzIxMmJhc2ljX3N0cmluZ0loTlNfMTFjaGFyX3RyYWl0c0loRUVOU185YWxsb2NhdG9ySWhFRUVFAE5TdDNfXzIxMmJhc2ljX3N0cmluZ0ljTlNfMTFjaGFyX3RyYWl0c0ljRUVOU185YWxsb2NhdG9ySWNFRUVFAE4xMF9fY3h4YWJpdjExNl9fc2hpbV90eXBlX2luZm9FAFN0OXR5cGVfaW5mbwBOMTBfX2N4eGFiaXYxMjBfX3NpX2NsYXNzX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTE3X19jbGFzc190eXBlX2luZm9FAE4xMF9fY3h4YWJpdjExN19fcGJhc2VfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMTlfX3BvaW50ZXJfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMjBfX2Z1bmN0aW9uX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTI5X19wb2ludGVyX3RvX21lbWJlcl90eXBlX2luZm9FAE4xMF9fY3h4YWJpdjEyM19fZnVuZGFtZW50YWxfdHlwZV9pbmZvRQB2AERuAGIAYwBoAGEAcwB0AGkAagBsAG0AZgBkAE4xMF9fY3h4YWJpdjEyMV9fdm1pX2NsYXNzX3R5cGVfaW5mb0U=';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary() {
  try {
    if (wasmBinary) {
      return new Uint8Array(wasmBinary);
    }

    var binary = tryParseAsDataURI(wasmBinaryFile);
    if (binary) {
      return binary;
    }
    if (readBinary) {
      return readBinary(wasmBinaryFile);
    } else {
      throw "sync fetching of the wasm failed: you can preload it to Module['wasmBinary'] manually, or emcc.py will do that for you when generating HTML (but not JS)";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}



// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm(env) {
  // prepare imports
  var info = {
    'env': env,
    'wasi_unstable': env
    ,
    'global': {
      'NaN': NaN,
      'Infinity': Infinity
    },
    'global.Math': Math,
    'asm2wasm': asm2wasmImports
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
   // we can't run yet (except in a pthread, where we have a custom sync instantiator)
  addRunDependency('wasm-instantiate');


  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }


  function instantiateArrayBuffer(receiver) {
    return getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }

  // Prefer streaming instantiation if available.
  function instantiateSync() {
    var instance;
    var module;
    var binary;
    try {
      binary = getBinary();
      module = new WebAssembly.Module(binary);
      instance = new WebAssembly.Instance(module, info);
    } catch (e) {
      var str = e.toString();
      err('failed to compile wasm module: ' + str);
      if (str.indexOf('imported Memory') >= 0 ||
          str.indexOf('memory import') >= 0) {
        err('Memory size incompatibility issues may be due to changing TOTAL_MEMORY at runtime to something too large. Use ALLOW_MEMORY_GROWTH to allow any size memory (and also make sure not to set TOTAL_MEMORY at runtime to something smaller than it was at compile time).');
      }
      throw e;
    }
    receiveInstance(instance, module);
  }
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      var exports = Module['instantiateWasm'](info, receiveInstance);
      return exports;
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  instantiateSync();
  return Module['asm']; // exports were assigned here
}

// Provide an "asm.js function" for the application, called to "link" the asm.js module. We instantiate
// the wasm module at that time, and it receives imports and provides exports and so forth, the app
// doesn't need to care that it is wasm or asm.js.

Module['asm'] = function(global, env, providedBuffer) {
  // memory was already allocated (so js could use the buffer)
  env['memory'] = wasmMemory
  ;
  // import table
  env['table'] = wasmTable = new WebAssembly.Table({
    'initial': 47,
    'maximum': 47,
    'element': 'anyfunc'
  });
  // With the wasm backend __memory_base and __table_base and only needed for
  // relocatable output.
  env['__memory_base'] = 1024; // tell the memory segments where to place themselves
  // table starts at 0 by default (even in dynamic linking, for the main module)
  env['__table_base'] = 0;

  var exports = createWasm(env);
  return exports;
};

// Globals used by JS i64 conversions
var tempDouble;
var tempI64;

// === Body ===

var ASM_CONSTS = [];





// STATICTOP = STATIC_BASE + 4368;
/* global initializers */  __ATINIT__.push({ func: function() { globalCtors() } });








/* no memory initializer */
var tempDoublePtr = 5376

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  function demangle(func) {
      return func;
    }

  function demangleAll(text) {
      var regex =
        /\b__Z[\w\d_]+/g;
      return text.replace(regex,
        function(x) {
          var y = demangle(x);
          return x === y ? x : (y + ' [' + x + ']');
        });
    }

  function jsStackTrace() {
      var err = new Error();
      if (!err.stack) {
        // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
        // so try that as a special-case.
        try {
          throw new Error(0);
        } catch(e) {
          err = e;
        }
        if (!err.stack) {
          return '(no stack trace available)';
        }
      }
      return err.stack.toString();
    }

  function stackTrace() {
      var js = jsStackTrace();
      if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
      return demangleAll(js);
    }

  function ___cxa_uncaught_exceptions() {
      return __ZSt18uncaught_exceptionv.uncaught_exceptions;
    }

  function ___gxx_personality_v0() {
    }

  
  function getShiftFromSize(size) {
      switch (size) {
          case 1: return 0;
          case 2: return 1;
          case 4: return 2;
          case 8: return 3;
          default:
              throw new TypeError('Unknown type size: ' + size);
      }
    }
  
  
  
  function embind_init_charCodes() {
      var codes = new Array(256);
      for (var i = 0; i < 256; ++i) {
          codes[i] = String.fromCharCode(i);
      }
      embind_charCodes = codes;
    }var embind_charCodes=undefined;function readLatin1String(ptr) {
      var ret = "";
      var c = ptr;
      while (HEAPU8[c]) {
          ret += embind_charCodes[HEAPU8[c++]];
      }
      return ret;
    }
  
  
  var awaitingDependencies={};
  
  var registeredTypes={};
  
  var typeDependencies={};
  
  
  
  
  
  
  var char_0=48;
  
  var char_9=57;function makeLegalFunctionName(name) {
      if (undefined === name) {
          return '_unknown';
      }
      name = name.replace(/[^a-zA-Z0-9_]/g, '$');
      var f = name.charCodeAt(0);
      if (f >= char_0 && f <= char_9) {
          return '_' + name;
      } else {
          return name;
      }
    }function createNamedFunction(name, body) {
      name = makeLegalFunctionName(name);
      return function() {
        "use strict";
        return body.apply(this, arguments);
      };
    }function extendError(baseErrorType, errorName) {
      var errorClass = createNamedFunction(errorName, function(message) {
          this.name = errorName;
          this.message = message;
  
          var stack = (new Error(message)).stack;
          if (stack !== undefined) {
              this.stack = this.toString() + '\n' +
                  stack.replace(/^Error(:[^\n]*)?\n/, '');
          }
      });
      errorClass.prototype = Object.create(baseErrorType.prototype);
      errorClass.prototype.constructor = errorClass;
      errorClass.prototype.toString = function() {
          if (this.message === undefined) {
              return this.name;
          } else {
              return this.name + ': ' + this.message;
          }
      };
  
      return errorClass;
    }var BindingError=undefined;function throwBindingError(message) {
      throw new BindingError(message);
    }
  
  
  
  var InternalError=undefined;function throwInternalError(message) {
      throw new InternalError(message);
    }function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
      myTypes.forEach(function(type) {
          typeDependencies[type] = dependentTypes;
      });
  
      function onComplete(typeConverters) {
          var myTypeConverters = getTypeConverters(typeConverters);
          if (myTypeConverters.length !== myTypes.length) {
              throwInternalError('Mismatched type converter count');
          }
          for (var i = 0; i < myTypes.length; ++i) {
              registerType(myTypes[i], myTypeConverters[i]);
          }
      }
  
      var typeConverters = new Array(dependentTypes.length);
      var unregisteredTypes = [];
      var registered = 0;
      dependentTypes.forEach(function(dt, i) {
          if (registeredTypes.hasOwnProperty(dt)) {
              typeConverters[i] = registeredTypes[dt];
          } else {
              unregisteredTypes.push(dt);
              if (!awaitingDependencies.hasOwnProperty(dt)) {
                  awaitingDependencies[dt] = [];
              }
              awaitingDependencies[dt].push(function() {
                  typeConverters[i] = registeredTypes[dt];
                  ++registered;
                  if (registered === unregisteredTypes.length) {
                      onComplete(typeConverters);
                  }
              });
          }
      });
      if (0 === unregisteredTypes.length) {
          onComplete(typeConverters);
      }
    }function registerType(rawType, registeredInstance, options) {
      options = options || {};
  
      if (!('argPackAdvance' in registeredInstance)) {
          throw new TypeError('registerType registeredInstance requires argPackAdvance');
      }
  
      var name = registeredInstance.name;
      if (!rawType) {
          throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
      }
      if (registeredTypes.hasOwnProperty(rawType)) {
          if (options.ignoreDuplicateRegistrations) {
              return;
          } else {
              throwBindingError("Cannot register type '" + name + "' twice");
          }
      }
  
      registeredTypes[rawType] = registeredInstance;
      delete typeDependencies[rawType];
  
      if (awaitingDependencies.hasOwnProperty(rawType)) {
          var callbacks = awaitingDependencies[rawType];
          delete awaitingDependencies[rawType];
          callbacks.forEach(function(cb) {
              cb();
          });
      }
    }function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
      var shift = getShiftFromSize(size);
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(wt) {
              // ambiguous emscripten ABI: sometimes return values are
              // true or false, and sometimes integers (0 or 1)
              return !!wt;
          },
          'toWireType': function(destructors, o) {
              return o ? trueValue : falseValue;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': function(pointer) {
              // TODO: if heap is fixed (like in asm.js) this could be executed outside
              var heap;
              if (size === 1) {
                  heap = HEAP8;
              } else if (size === 2) {
                  heap = HEAP16;
              } else if (size === 4) {
                  heap = HEAP32;
              } else {
                  throw new TypeError("Unknown boolean type size: " + name);
              }
              return this['fromWireType'](heap[pointer >> shift]);
          },
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  
  
  function ClassHandle_isAliasOf(other) {
      if (!(this instanceof ClassHandle)) {
          return false;
      }
      if (!(other instanceof ClassHandle)) {
          return false;
      }
  
      var leftClass = this.$$.ptrType.registeredClass;
      var left = this.$$.ptr;
      var rightClass = other.$$.ptrType.registeredClass;
      var right = other.$$.ptr;
  
      while (leftClass.baseClass) {
          left = leftClass.upcast(left);
          leftClass = leftClass.baseClass;
      }
  
      while (rightClass.baseClass) {
          right = rightClass.upcast(right);
          rightClass = rightClass.baseClass;
      }
  
      return leftClass === rightClass && left === right;
    }
  
  
  function shallowCopyInternalPointer(o) {
      return {
          count: o.count,
          deleteScheduled: o.deleteScheduled,
          preservePointerOnDelete: o.preservePointerOnDelete,
          ptr: o.ptr,
          ptrType: o.ptrType,
          smartPtr: o.smartPtr,
          smartPtrType: o.smartPtrType,
      };
    }
  
  function throwInstanceAlreadyDeleted(obj) {
      function getInstanceTypeName(handle) {
        return handle.$$.ptrType.registeredClass.name;
      }
      throwBindingError(getInstanceTypeName(obj) + ' instance already deleted');
    }
  
  
  var finalizationGroup=false;
  
  function detachFinalizer(handle) {}
  
  
  function runDestructor($$) {
      if ($$.smartPtr) {
          $$.smartPtrType.rawDestructor($$.smartPtr);
      } else {
          $$.ptrType.registeredClass.rawDestructor($$.ptr);
      }
    }function releaseClassHandle($$) {
      $$.count.value -= 1;
      var toDelete = 0 === $$.count.value;
      if (toDelete) {
          runDestructor($$);
      }
    }function attachFinalizer(handle) {
      if ('undefined' === typeof FinalizationGroup) {
          attachFinalizer = function (handle) { return handle; };
          return handle;
      }
      // If the running environment has a FinalizationGroup (see
      // https://github.com/tc39/proposal-weakrefs), then attach finalizers
      // for class handles.  We check for the presence of FinalizationGroup
      // at run-time, not build-time.
      finalizationGroup = new FinalizationGroup(function (iter) {
          for (var result = iter.next(); !result.done; result = iter.next()) {
              var $$ = result.value;
              if (!$$.ptr) {
                  console.warn('object already deleted: ' + $$.ptr);
              } else {
                  releaseClassHandle($$);
              }
          }
      });
      attachFinalizer = function(handle) {
          finalizationGroup.register(handle, handle.$$, handle.$$);
          return handle;
      };
      detachFinalizer = function(handle) {
          finalizationGroup.unregister(handle.$$);
      };
      return attachFinalizer(handle);
    }function ClassHandle_clone() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
  
      if (this.$$.preservePointerOnDelete) {
          this.$$.count.value += 1;
          return this;
      } else {
          var clone = attachFinalizer(Object.create(Object.getPrototypeOf(this), {
              $$: {
                  value: shallowCopyInternalPointer(this.$$),
              }
          }));
  
          clone.$$.count.value += 1;
          clone.$$.deleteScheduled = false;
          return clone;
      }
    }
  
  function ClassHandle_delete() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
  
      if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
      }
  
      detachFinalizer(this);
      releaseClassHandle(this.$$);
  
      if (!this.$$.preservePointerOnDelete) {
          this.$$.smartPtr = undefined;
          this.$$.ptr = undefined;
      }
    }
  
  function ClassHandle_isDeleted() {
      return !this.$$.ptr;
    }
  
  
  var delayFunction=undefined;
  
  var deletionQueue=[];
  
  function flushPendingDeletes() {
      while (deletionQueue.length) {
          var obj = deletionQueue.pop();
          obj.$$.deleteScheduled = false;
          obj['delete']();
      }
    }function ClassHandle_deleteLater() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
      if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
      }
      deletionQueue.push(this);
      if (deletionQueue.length === 1 && delayFunction) {
          delayFunction(flushPendingDeletes);
      }
      this.$$.deleteScheduled = true;
      return this;
    }function init_ClassHandle() {
      ClassHandle.prototype['isAliasOf'] = ClassHandle_isAliasOf;
      ClassHandle.prototype['clone'] = ClassHandle_clone;
      ClassHandle.prototype['delete'] = ClassHandle_delete;
      ClassHandle.prototype['isDeleted'] = ClassHandle_isDeleted;
      ClassHandle.prototype['deleteLater'] = ClassHandle_deleteLater;
    }function ClassHandle() {
    }
  
  var registeredPointers={};
  
  
  function ensureOverloadTable(proto, methodName, humanName) {
      if (undefined === proto[methodName].overloadTable) {
          var prevFunc = proto[methodName];
          // Inject an overload resolver function that routes to the appropriate overload based on the number of arguments.
          proto[methodName] = function() {
              // TODO This check can be removed in -O3 level "unsafe" optimizations.
              if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
                  throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
              }
              return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
          };
          // Move the previous function into the overload table.
          proto[methodName].overloadTable = [];
          proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
      }
    }function exposePublicSymbol(name, value, numArguments) {
      if (Module.hasOwnProperty(name)) {
          if (undefined === numArguments || (undefined !== Module[name].overloadTable && undefined !== Module[name].overloadTable[numArguments])) {
              throwBindingError("Cannot register public name '" + name + "' twice");
          }
  
          // We are exposing a function with the same name as an existing function. Create an overload table and a function selector
          // that routes between the two.
          ensureOverloadTable(Module, name, name);
          if (Module.hasOwnProperty(numArguments)) {
              throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
          }
          // Add the new function into the overload table.
          Module[name].overloadTable[numArguments] = value;
      }
      else {
          Module[name] = value;
          if (undefined !== numArguments) {
              Module[name].numArguments = numArguments;
          }
      }
    }
  
  function RegisteredClass(
      name,
      constructor,
      instancePrototype,
      rawDestructor,
      baseClass,
      getActualType,
      upcast,
      downcast
    ) {
      this.name = name;
      this.constructor = constructor;
      this.instancePrototype = instancePrototype;
      this.rawDestructor = rawDestructor;
      this.baseClass = baseClass;
      this.getActualType = getActualType;
      this.upcast = upcast;
      this.downcast = downcast;
      this.pureVirtualFunctions = [];
    }
  
  
  
  function upcastPointer(ptr, ptrClass, desiredClass) {
      while (ptrClass !== desiredClass) {
          if (!ptrClass.upcast) {
              throwBindingError("Expected null or instance of " + desiredClass.name + ", got an instance of " + ptrClass.name);
          }
          ptr = ptrClass.upcast(ptr);
          ptrClass = ptrClass.baseClass;
      }
      return ptr;
    }function constNoSmartPtrRawPointerToWireType(destructors, handle) {
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
          return 0;
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
      return ptr;
    }
  
  function genericPointerToWireType(destructors, handle) {
      var ptr;
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
  
          if (this.isSmartPointer) {
              ptr = this.rawConstructor();
              if (destructors !== null) {
                  destructors.push(this.rawDestructor, ptr);
              }
              return ptr;
          } else {
              return 0;
          }
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      if (!this.isConst && handle.$$.ptrType.isConst) {
          throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
  
      if (this.isSmartPointer) {
          // TODO: this is not strictly true
          // We could support BY_EMVAL conversions from raw pointers to smart pointers
          // because the smart pointer can hold a reference to the handle
          if (undefined === handle.$$.smartPtr) {
              throwBindingError('Passing raw pointer to smart pointer is illegal');
          }
  
          switch (this.sharingPolicy) {
              case 0: // NONE
                  // no upcasting
                  if (handle.$$.smartPtrType === this) {
                      ptr = handle.$$.smartPtr;
                  } else {
                      throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
                  }
                  break;
  
              case 1: // INTRUSIVE
                  ptr = handle.$$.smartPtr;
                  break;
  
              case 2: // BY_EMVAL
                  if (handle.$$.smartPtrType === this) {
                      ptr = handle.$$.smartPtr;
                  } else {
                      var clonedHandle = handle['clone']();
                      ptr = this.rawShare(
                          ptr,
                          __emval_register(function() {
                              clonedHandle['delete']();
                          })
                      );
                      if (destructors !== null) {
                          destructors.push(this.rawDestructor, ptr);
                      }
                  }
                  break;
  
              default:
                  throwBindingError('Unsupporting sharing policy');
          }
      }
      return ptr;
    }
  
  function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
          return 0;
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      if (handle.$$.ptrType.isConst) {
          throwBindingError('Cannot convert argument of type ' + handle.$$.ptrType.name + ' to parameter type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
      return ptr;
    }
  
  
  function simpleReadValueFromPointer(pointer) {
      return this['fromWireType'](HEAPU32[pointer >> 2]);
    }
  
  function RegisteredPointer_getPointee(ptr) {
      if (this.rawGetPointee) {
          ptr = this.rawGetPointee(ptr);
      }
      return ptr;
    }
  
  function RegisteredPointer_destructor(ptr) {
      if (this.rawDestructor) {
          this.rawDestructor(ptr);
      }
    }
  
  function RegisteredPointer_deleteObject(handle) {
      if (handle !== null) {
          handle['delete']();
      }
    }
  
  
  function downcastPointer(ptr, ptrClass, desiredClass) {
      if (ptrClass === desiredClass) {
          return ptr;
      }
      if (undefined === desiredClass.baseClass) {
          return null; // no conversion
      }
  
      var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
      if (rv === null) {
          return null;
      }
      return desiredClass.downcast(rv);
    }
  
  
  
  
  function getInheritedInstanceCount() {
      return Object.keys(registeredInstances).length;
    }
  
  function getLiveInheritedInstances() {
      var rv = [];
      for (var k in registeredInstances) {
          if (registeredInstances.hasOwnProperty(k)) {
              rv.push(registeredInstances[k]);
          }
      }
      return rv;
    }
  
  function setDelayFunction(fn) {
      delayFunction = fn;
      if (deletionQueue.length && delayFunction) {
          delayFunction(flushPendingDeletes);
      }
    }function init_embind() {
      Module['getInheritedInstanceCount'] = getInheritedInstanceCount;
      Module['getLiveInheritedInstances'] = getLiveInheritedInstances;
      Module['flushPendingDeletes'] = flushPendingDeletes;
      Module['setDelayFunction'] = setDelayFunction;
    }var registeredInstances={};
  
  function getBasestPointer(class_, ptr) {
      if (ptr === undefined) {
          throwBindingError('ptr should not be undefined');
      }
      while (class_.baseClass) {
          ptr = class_.upcast(ptr);
          class_ = class_.baseClass;
      }
      return ptr;
    }function getInheritedInstance(class_, ptr) {
      ptr = getBasestPointer(class_, ptr);
      return registeredInstances[ptr];
    }
  
  function makeClassHandle(prototype, record) {
      if (!record.ptrType || !record.ptr) {
          throwInternalError('makeClassHandle requires ptr and ptrType');
      }
      var hasSmartPtrType = !!record.smartPtrType;
      var hasSmartPtr = !!record.smartPtr;
      if (hasSmartPtrType !== hasSmartPtr) {
          throwInternalError('Both smartPtrType and smartPtr must be specified');
      }
      record.count = { value: 1 };
      return attachFinalizer(Object.create(prototype, {
          $$: {
              value: record,
          },
      }));
    }function RegisteredPointer_fromWireType(ptr) {
      // ptr is a raw pointer (or a raw smartpointer)
  
      // rawPointer is a maybe-null raw pointer
      var rawPointer = this.getPointee(ptr);
      if (!rawPointer) {
          this.destructor(ptr);
          return null;
      }
  
      var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
      if (undefined !== registeredInstance) {
          // JS object has been neutered, time to repopulate it
          if (0 === registeredInstance.$$.count.value) {
              registeredInstance.$$.ptr = rawPointer;
              registeredInstance.$$.smartPtr = ptr;
              return registeredInstance['clone']();
          } else {
              // else, just increment reference count on existing object
              // it already has a reference to the smart pointer
              var rv = registeredInstance['clone']();
              this.destructor(ptr);
              return rv;
          }
      }
  
      function makeDefaultHandle() {
          if (this.isSmartPointer) {
              return makeClassHandle(this.registeredClass.instancePrototype, {
                  ptrType: this.pointeeType,
                  ptr: rawPointer,
                  smartPtrType: this,
                  smartPtr: ptr,
              });
          } else {
              return makeClassHandle(this.registeredClass.instancePrototype, {
                  ptrType: this,
                  ptr: ptr,
              });
          }
      }
  
      var actualType = this.registeredClass.getActualType(rawPointer);
      var registeredPointerRecord = registeredPointers[actualType];
      if (!registeredPointerRecord) {
          return makeDefaultHandle.call(this);
      }
  
      var toType;
      if (this.isConst) {
          toType = registeredPointerRecord.constPointerType;
      } else {
          toType = registeredPointerRecord.pointerType;
      }
      var dp = downcastPointer(
          rawPointer,
          this.registeredClass,
          toType.registeredClass);
      if (dp === null) {
          return makeDefaultHandle.call(this);
      }
      if (this.isSmartPointer) {
          return makeClassHandle(toType.registeredClass.instancePrototype, {
              ptrType: toType,
              ptr: dp,
              smartPtrType: this,
              smartPtr: ptr,
          });
      } else {
          return makeClassHandle(toType.registeredClass.instancePrototype, {
              ptrType: toType,
              ptr: dp,
          });
      }
    }function init_RegisteredPointer() {
      RegisteredPointer.prototype.getPointee = RegisteredPointer_getPointee;
      RegisteredPointer.prototype.destructor = RegisteredPointer_destructor;
      RegisteredPointer.prototype['argPackAdvance'] = 8;
      RegisteredPointer.prototype['readValueFromPointer'] = simpleReadValueFromPointer;
      RegisteredPointer.prototype['deleteObject'] = RegisteredPointer_deleteObject;
      RegisteredPointer.prototype['fromWireType'] = RegisteredPointer_fromWireType;
    }function RegisteredPointer(
      name,
      registeredClass,
      isReference,
      isConst,
  
      // smart pointer properties
      isSmartPointer,
      pointeeType,
      sharingPolicy,
      rawGetPointee,
      rawConstructor,
      rawShare,
      rawDestructor
    ) {
      this.name = name;
      this.registeredClass = registeredClass;
      this.isReference = isReference;
      this.isConst = isConst;
  
      // smart pointer properties
      this.isSmartPointer = isSmartPointer;
      this.pointeeType = pointeeType;
      this.sharingPolicy = sharingPolicy;
      this.rawGetPointee = rawGetPointee;
      this.rawConstructor = rawConstructor;
      this.rawShare = rawShare;
      this.rawDestructor = rawDestructor;
  
      if (!isSmartPointer && registeredClass.baseClass === undefined) {
          if (isConst) {
              this['toWireType'] = constNoSmartPtrRawPointerToWireType;
              this.destructorFunction = null;
          } else {
              this['toWireType'] = nonConstNoSmartPtrRawPointerToWireType;
              this.destructorFunction = null;
          }
      } else {
          this['toWireType'] = genericPointerToWireType;
          // Here we must leave this.destructorFunction undefined, since whether genericPointerToWireType returns
          // a pointer that needs to be freed up is runtime-dependent, and cannot be evaluated at registration time.
          // TODO: Create an alternative mechanism that allows removing the use of var destructors = []; array in
          //       craftInvokerFunction altogether.
      }
    }
  
  function replacePublicSymbol(name, value, numArguments) {
      if (!Module.hasOwnProperty(name)) {
          throwInternalError('Replacing nonexistant public symbol');
      }
      // If there's an overload table for this symbol, replace the symbol in the overload table instead.
      if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
          Module[name].overloadTable[numArguments] = value;
      }
      else {
          Module[name] = value;
          Module[name].argCount = numArguments;
      }
    }
  
  function embind__requireFunction(signature, rawFunction) {
      signature = readLatin1String(signature);
  
      function makeDynCaller(dynCall) {
        return function() {
            var args = new Array(arguments.length + 1);
            args[0] = rawFunction;
            for (var i = 0; i < arguments.length; i++) {
              args[i + 1] = arguments[i];
            }
            return dynCall.apply(null, args);
        };
      }
  
      var fp;
      if (Module['FUNCTION_TABLE_' + signature] !== undefined) {
          fp = Module['FUNCTION_TABLE_' + signature][rawFunction];
      } else if (typeof FUNCTION_TABLE !== "undefined") {
          fp = FUNCTION_TABLE[rawFunction];
      } else {
          // asm.js does not give direct access to the function tables,
          // and thus we must go through the dynCall interface which allows
          // calling into a signature's function table by pointer value.
          //
          // https://github.com/dherman/asm.js/issues/83
          //
          // This has three main penalties:
          // - dynCall is another function call in the path from JavaScript to C++.
          // - JITs may not predict through the function table indirection at runtime.
          var dc = Module['dynCall_' + signature];
          if (dc === undefined) {
              // We will always enter this branch if the signature
              // contains 'f' and PRECISE_F32 is not enabled.
              //
              // Try again, replacing 'f' with 'd'.
              dc = Module['dynCall_' + signature.replace(/f/g, 'd')];
              if (dc === undefined) {
                  throwBindingError("No dynCall invoker for signature: " + signature);
              }
          }
          fp = makeDynCaller(dc);
      }
  
      if (typeof fp !== "function") {
          throwBindingError("unknown function pointer with signature " + signature + ": " + rawFunction);
      }
      return fp;
    }
  
  
  var UnboundTypeError=undefined;
  
  function getTypeName(type) {
      var ptr = ___getTypeName(type);
      var rv = readLatin1String(ptr);
      _free(ptr);
      return rv;
    }function throwUnboundTypeError(message, types) {
      var unboundTypes = [];
      var seen = {};
      function visit(type) {
          if (seen[type]) {
              return;
          }
          if (registeredTypes[type]) {
              return;
          }
          if (typeDependencies[type]) {
              typeDependencies[type].forEach(visit);
              return;
          }
          unboundTypes.push(type);
          seen[type] = true;
      }
      types.forEach(visit);
  
      throw new UnboundTypeError(message + ': ' + unboundTypes.map(getTypeName).join([', ']));
    }function __embind_register_class(
      rawType,
      rawPointerType,
      rawConstPointerType,
      baseClassRawType,
      getActualTypeSignature,
      getActualType,
      upcastSignature,
      upcast,
      downcastSignature,
      downcast,
      name,
      destructorSignature,
      rawDestructor
    ) {
      name = readLatin1String(name);
      getActualType = embind__requireFunction(getActualTypeSignature, getActualType);
      if (upcast) {
          upcast = embind__requireFunction(upcastSignature, upcast);
      }
      if (downcast) {
          downcast = embind__requireFunction(downcastSignature, downcast);
      }
      rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);
      var legalFunctionName = makeLegalFunctionName(name);
  
      exposePublicSymbol(legalFunctionName, function() {
          // this code cannot run if baseClassRawType is zero
          throwUnboundTypeError('Cannot construct ' + name + ' due to unbound types', [baseClassRawType]);
      });
  
      whenDependentTypesAreResolved(
          [rawType, rawPointerType, rawConstPointerType],
          baseClassRawType ? [baseClassRawType] : [],
          function(base) {
              base = base[0];
  
              var baseClass;
              var basePrototype;
              if (baseClassRawType) {
                  baseClass = base.registeredClass;
                  basePrototype = baseClass.instancePrototype;
              } else {
                  basePrototype = ClassHandle.prototype;
              }
  
              var constructor = createNamedFunction(legalFunctionName, function() {
                  if (Object.getPrototypeOf(this) !== instancePrototype) {
                      throw new BindingError("Use 'new' to construct " + name);
                  }
                  if (undefined === registeredClass.constructor_body) {
                      throw new BindingError(name + " has no accessible constructor");
                  }
                  var body = registeredClass.constructor_body[arguments.length];
                  if (undefined === body) {
                      throw new BindingError("Tried to invoke ctor of " + name + " with invalid number of parameters (" + arguments.length + ") - expected (" + Object.keys(registeredClass.constructor_body).toString() + ") parameters instead!");
                  }
                  return body.apply(this, arguments);
              });
  
              var instancePrototype = Object.create(basePrototype, {
                  constructor: { value: constructor },
              });
  
              constructor.prototype = instancePrototype;
  
              var registeredClass = new RegisteredClass(
                  name,
                  constructor,
                  instancePrototype,
                  rawDestructor,
                  baseClass,
                  getActualType,
                  upcast,
                  downcast);
  
              var referenceConverter = new RegisteredPointer(
                  name,
                  registeredClass,
                  true,
                  false,
                  false);
  
              var pointerConverter = new RegisteredPointer(
                  name + '*',
                  registeredClass,
                  false,
                  false,
                  false);
  
              var constPointerConverter = new RegisteredPointer(
                  name + ' const*',
                  registeredClass,
                  false,
                  true,
                  false);
  
              registeredPointers[rawType] = {
                  pointerType: pointerConverter,
                  constPointerType: constPointerConverter
              };
  
              replacePublicSymbol(legalFunctionName, constructor);
  
              return [referenceConverter, pointerConverter, constPointerConverter];
          }
      );
    }

  
  function heap32VectorToArray(count, firstElement) {
      var array = [];
      for (var i = 0; i < count; i++) {
          array.push(HEAP32[(firstElement >> 2) + i]);
      }
      return array;
    }
  
  function runDestructors(destructors) {
      while (destructors.length) {
          var ptr = destructors.pop();
          var del = destructors.pop();
          del(ptr);
      }
    }function __embind_register_class_constructor(
      rawClassType,
      argCount,
      rawArgTypesAddr,
      invokerSignature,
      invoker,
      rawConstructor
    ) {
      var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
      invoker = embind__requireFunction(invokerSignature, invoker);
  
      whenDependentTypesAreResolved([], [rawClassType], function(classType) {
          classType = classType[0];
          var humanName = 'constructor ' + classType.name;
  
          if (undefined === classType.registeredClass.constructor_body) {
              classType.registeredClass.constructor_body = [];
          }
          if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
              throw new BindingError("Cannot register multiple constructors with identical number of parameters (" + (argCount-1) + ") for class '" + classType.name + "'! Overload resolution is currently only performed using the parameter count, not actual type info!");
          }
          classType.registeredClass.constructor_body[argCount - 1] = function unboundTypeHandler() {
              throwUnboundTypeError('Cannot construct ' + classType.name + ' due to unbound types', rawArgTypes);
          };
  
          whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
              classType.registeredClass.constructor_body[argCount - 1] = function constructor_body() {
                  if (arguments.length !== argCount - 1) {
                      throwBindingError(humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argCount-1));
                  }
                  var destructors = [];
                  var args = new Array(argCount);
                  args[0] = rawConstructor;
                  for (var i = 1; i < argCount; ++i) {
                      args[i] = argTypes[i]['toWireType'](destructors, arguments[i - 1]);
                  }
  
                  var ptr = invoker.apply(null, args);
                  runDestructors(destructors);
  
                  return argTypes[0]['fromWireType'](ptr);
              };
              return [];
          });
          return [];
      });
    }

  
  
  function new_(constructor, argumentList) {
      if (!(constructor instanceof Function)) {
          throw new TypeError('new_ called with constructor type ' + typeof(constructor) + " which is not a function");
      }
      if (constructor === Function) {
        throw new Error('new_ cannot create a new Function with DYNAMIC_EXECUTION == 0.');
      }
  
      /*
       * Previously, the following line was just:
  
       function dummy() {};
  
       * Unfortunately, Chrome was preserving 'dummy' as the object's name, even though at creation, the 'dummy' has the
       * correct constructor name.  Thus, objects created with IMVU.new would show up in the debugger as 'dummy', which
       * isn't very helpful.  Using IMVU.createNamedFunction addresses the issue.  Doublely-unfortunately, there's no way
       * to write a test for this behavior.  -NRD 2013.02.22
       */
      var dummy = createNamedFunction(constructor.name || 'unknownFunctionName', function(){});
      dummy.prototype = constructor.prototype;
      var obj = new dummy;
  
      var r = constructor.apply(obj, argumentList);
      return (r instanceof Object) ? r : obj;
    }function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
      // humanName: a human-readable string name for the function to be generated.
      // argTypes: An array that contains the embind type objects for all types in the function signature.
      //    argTypes[0] is the type object for the function return value.
      //    argTypes[1] is the type object for function this object/class type, or null if not crafting an invoker for a class method.
      //    argTypes[2...] are the actual function parameters.
      // classType: The embind type object for the class to be bound, or null if this is not a method of a class.
      // cppInvokerFunc: JS Function object to the C++-side function that interops into C++ code.
      // cppTargetFunc: Function pointer (an integer to FUNCTION_TABLE) to the target C++ function the cppInvokerFunc will end up calling.
      var argCount = argTypes.length;
  
      if (argCount < 2) {
          throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
      }
  
      var isClassMethodFunc = (argTypes[1] !== null && classType !== null);
  
      // Free functions with signature "void function()" do not need an invoker that marshalls between wire types.
  // TODO: This omits argument count check - enable only at -O3 or similar.
  //    if (ENABLE_UNSAFE_OPTS && argCount == 2 && argTypes[0].name == "void" && !isClassMethodFunc) {
  //       return FUNCTION_TABLE[fn];
  //    }
  
  
      // Determine if we need to use a dynamic stack to store the destructors for the function parameters.
      // TODO: Remove this completely once all function invokers are being dynamically generated.
      var needsDestructorStack = false;
  
      for(var i = 1; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here.
          if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) { // The type does not define a destructor function - must use dynamic stack
              needsDestructorStack = true;
              break;
          }
      }
  
      var returns = (argTypes[0].name !== "void");
  
      var argsWired = new Array(argCount - 2);
      return function() {
        if (arguments.length !== argCount - 2) {
          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argCount - 2) + ' args!');
        }
        var destructors = needsDestructorStack ? [] : null;
        var thisWired;
        if (isClassMethodFunc) {
          thisWired = argTypes[1].toWireType(destructors, this);
        }
        for (var i = 0; i < argCount - 2; ++i) {
          argsWired[i] = argTypes[i + 2].toWireType(destructors, arguments[i]);
        }
  
        var invokerFuncArgs = isClassMethodFunc ?
            [cppTargetFunc, thisWired] : [cppTargetFunc];
  
        var rv = cppInvokerFunc.apply(null, invokerFuncArgs.concat(argsWired));
  
        if (needsDestructorStack) {
          runDestructors(destructors);
        } else {
          for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; i++) {
            var param = i === 1 ? thisWired : argsWired[i - 2];
            if (argTypes[i].destructorFunction !== null) {
              argTypes[i].destructorFunction(param);
            }
          }
        }
  
  
        if (returns) {
          return argTypes[0].fromWireType(rv);
        }
      };
    }function __embind_register_class_function(
      rawClassType,
      methodName,
      argCount,
      rawArgTypesAddr, // [ReturnType, ThisType, Args...]
      invokerSignature,
      rawInvoker,
      context,
      isPureVirtual
    ) {
      var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
      methodName = readLatin1String(methodName);
      rawInvoker = embind__requireFunction(invokerSignature, rawInvoker);
  
      whenDependentTypesAreResolved([], [rawClassType], function(classType) {
          classType = classType[0];
          var humanName = classType.name + '.' + methodName;
  
          if (isPureVirtual) {
              classType.registeredClass.pureVirtualFunctions.push(methodName);
          }
  
          function unboundTypesHandler() {
              throwUnboundTypeError('Cannot call ' + humanName + ' due to unbound types', rawArgTypes);
          }
  
          var proto = classType.registeredClass.instancePrototype;
          var method = proto[methodName];
          if (undefined === method || (undefined === method.overloadTable && method.className !== classType.name && method.argCount === argCount - 2)) {
              // This is the first overload to be registered, OR we are replacing a function in the base class with a function in the derived class.
              unboundTypesHandler.argCount = argCount - 2;
              unboundTypesHandler.className = classType.name;
              proto[methodName] = unboundTypesHandler;
          } else {
              // There was an existing function with the same name registered. Set up a function overload routing table.
              ensureOverloadTable(proto, methodName, humanName);
              proto[methodName].overloadTable[argCount - 2] = unboundTypesHandler;
          }
  
          whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
  
              var memberFunction = craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context);
  
              // Replace the initial unbound-handler-stub function with the appropriate member function, now that all types
              // are resolved. If multiple overloads are registered for this function, the function goes into an overload table.
              if (undefined === proto[methodName].overloadTable) {
                  // Set argCount in case an overload is registered later
                  memberFunction.argCount = argCount - 2;
                  proto[methodName] = memberFunction;
              } else {
                  proto[methodName].overloadTable[argCount - 2] = memberFunction;
              }
  
              return [];
          });
          return [];
      });
    }

  
  
  var emval_free_list=[];
  
  var emval_handle_array=[{},{value:undefined},{value:null},{value:true},{value:false}];function __emval_decref(handle) {
      if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
          emval_handle_array[handle] = undefined;
          emval_free_list.push(handle);
      }
    }
  
  
  
  function count_emval_handles() {
      var count = 0;
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              ++count;
          }
      }
      return count;
    }
  
  function get_first_emval() {
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              return emval_handle_array[i];
          }
      }
      return null;
    }function init_emval() {
      Module['count_emval_handles'] = count_emval_handles;
      Module['get_first_emval'] = get_first_emval;
    }function __emval_register(value) {
  
      switch(value){
        case undefined :{ return 1; }
        case null :{ return 2; }
        case true :{ return 3; }
        case false :{ return 4; }
        default:{
          var handle = emval_free_list.length ?
              emval_free_list.pop() :
              emval_handle_array.length;
  
          emval_handle_array[handle] = {refcount: 1, value: value};
          return handle;
          }
        }
    }function __embind_register_emval(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(handle) {
              var rv = emval_handle_array[handle].value;
              __emval_decref(handle);
              return rv;
          },
          'toWireType': function(destructors, value) {
              return __emval_register(value);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: null, // This type does not need a destructor
  
          // TODO: do we need a deleteObject here?  write a test where
          // emval is passed into JS via an interface
      });
    }

  
  function _embind_repr(v) {
      if (v === null) {
          return 'null';
      }
      var t = typeof v;
      if (t === 'object' || t === 'array' || t === 'function') {
          return v.toString();
      } else {
          return '' + v;
      }
    }
  
  function floatReadValueFromPointer(name, shift) {
      switch (shift) {
          case 2: return function(pointer) {
              return this['fromWireType'](HEAPF32[pointer >> 2]);
          };
          case 3: return function(pointer) {
              return this['fromWireType'](HEAPF64[pointer >> 3]);
          };
          default:
              throw new TypeError("Unknown float type: " + name);
      }
    }function __embind_register_float(rawType, name, size) {
      var shift = getShiftFromSize(size);
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              return value;
          },
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following if() and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              return value;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': floatReadValueFromPointer(name, shift),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  function integerReadValueFromPointer(name, shift, signed) {
      // integers are quite common, so generate very specialized functions
      switch (shift) {
          case 0: return signed ?
              function readS8FromPointer(pointer) { return HEAP8[pointer]; } :
              function readU8FromPointer(pointer) { return HEAPU8[pointer]; };
          case 1: return signed ?
              function readS16FromPointer(pointer) { return HEAP16[pointer >> 1]; } :
              function readU16FromPointer(pointer) { return HEAPU16[pointer >> 1]; };
          case 2: return signed ?
              function readS32FromPointer(pointer) { return HEAP32[pointer >> 2]; } :
              function readU32FromPointer(pointer) { return HEAPU32[pointer >> 2]; };
          default:
              throw new TypeError("Unknown integer type: " + name);
      }
    }function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
      name = readLatin1String(name);
      if (maxRange === -1) { // LLVM doesn't have signed and unsigned 32-bit types, so u32 literals come out as 'i32 -1'. Always treat those as max u32.
          maxRange = 4294967295;
      }
  
      var shift = getShiftFromSize(size);
  
      var fromWireType = function(value) {
          return value;
      };
  
      if (minRange === 0) {
          var bitshift = 32 - 8*size;
          fromWireType = function(value) {
              return (value << bitshift) >>> bitshift;
          };
      }
  
      var isUnsignedType = (name.indexOf('unsigned') != -1);
  
      registerType(primitiveType, {
          name: name,
          'fromWireType': fromWireType,
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following two if()s and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              if (value < minRange || value > maxRange) {
                  throw new TypeError('Passing a number "' + _embind_repr(value) + '" from JS side to C/C++ side to an argument of type "' + name + '", which is outside the valid range [' + minRange + ', ' + maxRange + ']!');
              }
              return isUnsignedType ? (value >>> 0) : (value | 0);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': integerReadValueFromPointer(name, shift, minRange !== 0),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  function __embind_register_memory_view(rawType, dataTypeIndex, name) {
      var typeMapping = [
          Int8Array,
          Uint8Array,
          Int16Array,
          Uint16Array,
          Int32Array,
          Uint32Array,
          Float32Array,
          Float64Array,
      ];
  
      var TA = typeMapping[dataTypeIndex];
  
      function decodeMemoryView(handle) {
          handle = handle >> 2;
          var heap = HEAPU32;
          var size = heap[handle]; // in elements
          var data = heap[handle + 1]; // byte offset into emscripten heap
          return new TA(heap['buffer'], data, size);
      }
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': decodeMemoryView,
          'argPackAdvance': 8,
          'readValueFromPointer': decodeMemoryView,
      }, {
          ignoreDuplicateRegistrations: true,
      });
    }

  function __embind_register_std_string(rawType, name) {
      name = readLatin1String(name);
      var stdStringIsUTF8
      //process only std::string bindings with UTF8 support, in contrast to e.g. std::basic_string<unsigned char>
      = (name === "std::string");
  
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var length = HEAPU32[value >> 2];
  
              var str;
              if(stdStringIsUTF8) {
                  //ensure null termination at one-past-end byte if not present yet
                  var endChar = HEAPU8[value + 4 + length];
                  var endCharSwap = 0;
                  if(endChar != 0)
                  {
                    endCharSwap = endChar;
                    HEAPU8[value + 4 + length] = 0;
                  }
  
                  var decodeStartPtr = value + 4;
                  //looping here to support possible embedded '0' bytes
                  for (var i = 0; i <= length; ++i) {
                    var currentBytePtr = value + 4 + i;
                    if(HEAPU8[currentBytePtr] == 0)
                    {
                      var stringSegment = UTF8ToString(decodeStartPtr);
                      if(str === undefined)
                        str = stringSegment;
                      else
                      {
                        str += String.fromCharCode(0);
                        str += stringSegment;
                      }
                      decodeStartPtr = currentBytePtr + 1;
                    }
                  }
  
                  if(endCharSwap != 0)
                    HEAPU8[value + 4 + length] = endCharSwap;
              } else {
                  var a = new Array(length);
                  for (var i = 0; i < length; ++i) {
                      a[i] = String.fromCharCode(HEAPU8[value + 4 + i]);
                  }
                  str = a.join('');
              }
  
              _free(value);
              
              return str;
          },
          'toWireType': function(destructors, value) {
              if (value instanceof ArrayBuffer) {
                  value = new Uint8Array(value);
              }
              
              var getLength;
              var valueIsOfTypeString = (typeof value === 'string');
  
              if (!(valueIsOfTypeString || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array)) {
                  throwBindingError('Cannot pass non-string to std::string');
              }
              if (stdStringIsUTF8 && valueIsOfTypeString) {
                  getLength = function() {return lengthBytesUTF8(value);};
              } else {
                  getLength = function() {return value.length;};
              }
              
              // assumes 4-byte alignment
              var length = getLength();
              var ptr = _malloc(4 + length + 1);
              HEAPU32[ptr >> 2] = length;
  
              if (stdStringIsUTF8 && valueIsOfTypeString) {
                  stringToUTF8(value, ptr + 4, length + 1);
              } else {
                  if(valueIsOfTypeString) {
                      for (var i = 0; i < length; ++i) {
                          var charCode = value.charCodeAt(i);
                          if (charCode > 255) {
                              _free(ptr);
                              throwBindingError('String has UTF-16 code units that do not fit in 8 bits');
                          }
                          HEAPU8[ptr + 4 + i] = charCode;
                      }
                  } else {
                      for (var i = 0; i < length; ++i) {
                          HEAPU8[ptr + 4 + i] = value[i];
                      }
                  }
              }
  
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function __embind_register_std_wstring(rawType, charSize, name) {
      // nb. do not cache HEAPU16 and HEAPU32, they may be destroyed by emscripten_resize_heap().
      name = readLatin1String(name);
      var getHeap, shift;
      if (charSize === 2) {
          getHeap = function() { return HEAPU16; };
          shift = 1;
      } else if (charSize === 4) {
          getHeap = function() { return HEAPU32; };
          shift = 2;
      }
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var HEAP = getHeap();
              var length = HEAPU32[value >> 2];
              var a = new Array(length);
              var start = (value + 4) >> shift;
              for (var i = 0; i < length; ++i) {
                  a[i] = String.fromCharCode(HEAP[start + i]);
              }
              _free(value);
              return a.join('');
          },
          'toWireType': function(destructors, value) {
              // assumes 4-byte alignment
              var HEAP = getHeap();
              var length = value.length;
              var ptr = _malloc(4 + length * charSize);
              HEAPU32[ptr >> 2] = length;
              var start = (ptr + 4) >> shift;
              for (var i = 0; i < length; ++i) {
                  HEAP[start + i] = value.charCodeAt(i);
              }
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function __embind_register_void(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          isVoid: true, // void return values can be optimized out sometimes
          name: name,
          'argPackAdvance': 0,
          'fromWireType': function() {
              return undefined;
          },
          'toWireType': function(destructors, o) {
              // TODO: assert if anything else is given?
              return undefined;
          },
      });
    }

  function _emscripten_get_heap_size() {
      return HEAP8.length;
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      return value;
    }
  
  
  function abortOnCannotGrowMemory(requestedSize) {
      abort('OOM');
    }function _emscripten_resize_heap(requestedSize) {
      abortOnCannotGrowMemory(requestedSize);
    } 
embind_init_charCodes();
BindingError = Module['BindingError'] = extendError(Error, 'BindingError');;
InternalError = Module['InternalError'] = extendError(Error, 'InternalError');;
init_ClassHandle();
init_RegisteredPointer();
init_embind();;
UnboundTypeError = Module['UnboundTypeError'] = extendError(Error, 'UnboundTypeError');;
init_emval();;
var ASSERTIONS = false;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149

// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

/**
 * Decodes a base64 string.
 * @param {String} input The string to decode.
 */
var decodeBase64 = typeof atob === 'function' ? atob : function (input) {
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
};

// Converts a string of base64 into a byte array.
// Throws error on invalid input.
function intArrayFromBase64(s) {
  if (typeof ENVIRONMENT_IS_NODE === 'boolean' && ENVIRONMENT_IS_NODE) {
    var buf;
    try {
      buf = Buffer.from(s, 'base64');
    } catch (_) {
      buf = new Buffer(s, 'base64');
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  try {
    var decoded = decodeBase64(s);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0 ; i < decoded.length ; ++i) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Error('Converting base64 string to bytes failed.');
  }
}

// If filename is a base64 data URI, parses and returns data (Buffer on node,
// Uint8Array otherwise). If filename is not a base64 data URI, returns undefined.
function tryParseAsDataURI(filename) {
  if (!isDataURI(filename)) {
    return;
  }

  return intArrayFromBase64(filename.slice(dataURIPrefix.length));
}


// ASM_LIBRARY EXTERN PRIMITIVES: Int8Array,Int32Array


var asmGlobalArg = {};

var asmLibraryArg = {
  "abort": abort,
  "setTempRet0": setTempRet0,
  "getTempRet0": getTempRet0,
  "ClassHandle": ClassHandle,
  "ClassHandle_clone": ClassHandle_clone,
  "ClassHandle_delete": ClassHandle_delete,
  "ClassHandle_deleteLater": ClassHandle_deleteLater,
  "ClassHandle_isAliasOf": ClassHandle_isAliasOf,
  "ClassHandle_isDeleted": ClassHandle_isDeleted,
  "RegisteredClass": RegisteredClass,
  "RegisteredPointer": RegisteredPointer,
  "RegisteredPointer_deleteObject": RegisteredPointer_deleteObject,
  "RegisteredPointer_destructor": RegisteredPointer_destructor,
  "RegisteredPointer_fromWireType": RegisteredPointer_fromWireType,
  "RegisteredPointer_getPointee": RegisteredPointer_getPointee,
  "___cxa_uncaught_exceptions": ___cxa_uncaught_exceptions,
  "___gxx_personality_v0": ___gxx_personality_v0,
  "___setErrNo": ___setErrNo,
  "__embind_register_bool": __embind_register_bool,
  "__embind_register_class": __embind_register_class,
  "__embind_register_class_constructor": __embind_register_class_constructor,
  "__embind_register_class_function": __embind_register_class_function,
  "__embind_register_emval": __embind_register_emval,
  "__embind_register_float": __embind_register_float,
  "__embind_register_integer": __embind_register_integer,
  "__embind_register_memory_view": __embind_register_memory_view,
  "__embind_register_std_string": __embind_register_std_string,
  "__embind_register_std_wstring": __embind_register_std_wstring,
  "__embind_register_void": __embind_register_void,
  "__emval_decref": __emval_decref,
  "__emval_register": __emval_register,
  "_embind_repr": _embind_repr,
  "_emscripten_get_heap_size": _emscripten_get_heap_size,
  "_emscripten_memcpy_big": _emscripten_memcpy_big,
  "_emscripten_resize_heap": _emscripten_resize_heap,
  "abortOnCannotGrowMemory": abortOnCannotGrowMemory,
  "attachFinalizer": attachFinalizer,
  "constNoSmartPtrRawPointerToWireType": constNoSmartPtrRawPointerToWireType,
  "count_emval_handles": count_emval_handles,
  "craftInvokerFunction": craftInvokerFunction,
  "createNamedFunction": createNamedFunction,
  "demangle": demangle,
  "demangleAll": demangleAll,
  "detachFinalizer": detachFinalizer,
  "downcastPointer": downcastPointer,
  "embind__requireFunction": embind__requireFunction,
  "embind_init_charCodes": embind_init_charCodes,
  "ensureOverloadTable": ensureOverloadTable,
  "exposePublicSymbol": exposePublicSymbol,
  "extendError": extendError,
  "floatReadValueFromPointer": floatReadValueFromPointer,
  "flushPendingDeletes": flushPendingDeletes,
  "genericPointerToWireType": genericPointerToWireType,
  "getBasestPointer": getBasestPointer,
  "getInheritedInstance": getInheritedInstance,
  "getInheritedInstanceCount": getInheritedInstanceCount,
  "getLiveInheritedInstances": getLiveInheritedInstances,
  "getShiftFromSize": getShiftFromSize,
  "getTypeName": getTypeName,
  "get_first_emval": get_first_emval,
  "heap32VectorToArray": heap32VectorToArray,
  "init_ClassHandle": init_ClassHandle,
  "init_RegisteredPointer": init_RegisteredPointer,
  "init_embind": init_embind,
  "init_emval": init_emval,
  "integerReadValueFromPointer": integerReadValueFromPointer,
  "jsStackTrace": jsStackTrace,
  "makeClassHandle": makeClassHandle,
  "makeLegalFunctionName": makeLegalFunctionName,
  "new_": new_,
  "nonConstNoSmartPtrRawPointerToWireType": nonConstNoSmartPtrRawPointerToWireType,
  "readLatin1String": readLatin1String,
  "registerType": registerType,
  "releaseClassHandle": releaseClassHandle,
  "replacePublicSymbol": replacePublicSymbol,
  "runDestructor": runDestructor,
  "runDestructors": runDestructors,
  "setDelayFunction": setDelayFunction,
  "shallowCopyInternalPointer": shallowCopyInternalPointer,
  "simpleReadValueFromPointer": simpleReadValueFromPointer,
  "stackTrace": stackTrace,
  "throwBindingError": throwBindingError,
  "throwInstanceAlreadyDeleted": throwInstanceAlreadyDeleted,
  "throwInternalError": throwInternalError,
  "throwUnboundTypeError": throwUnboundTypeError,
  "upcastPointer": upcastPointer,
  "whenDependentTypesAreResolved": whenDependentTypesAreResolved,
  "tempDoublePtr": tempDoublePtr,
  "DYNAMICTOP_PTR": DYNAMICTOP_PTR
};
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
(asmGlobalArg, asmLibraryArg, buffer);

var __ZSt18uncaught_exceptionv = Module["__ZSt18uncaught_exceptionv"] = asm["__ZSt18uncaught_exceptionv"];
var ___cxa_can_catch = Module["___cxa_can_catch"] = asm["___cxa_can_catch"];
var ___cxa_is_pointer_type = Module["___cxa_is_pointer_type"] = asm["___cxa_is_pointer_type"];
var ___embind_register_native_and_builtin_types = Module["___embind_register_native_and_builtin_types"] = asm["___embind_register_native_and_builtin_types"];
var ___errno_location = Module["___errno_location"] = asm["___errno_location"];
var ___getTypeName = Module["___getTypeName"] = asm["___getTypeName"];
var _free = Module["_free"] = asm["_free"];
var _malloc = Module["_malloc"] = asm["_malloc"];
var _memcpy = Module["_memcpy"] = asm["_memcpy"];
var _memset = Module["_memset"] = asm["_memset"];
var _sbrk = Module["_sbrk"] = asm["_sbrk"];
var establishStackSpace = Module["establishStackSpace"] = asm["establishStackSpace"];
var globalCtors = Module["globalCtors"] = asm["globalCtors"];
var stackAlloc = Module["stackAlloc"] = asm["stackAlloc"];
var stackRestore = Module["stackRestore"] = asm["stackRestore"];
var stackSave = Module["stackSave"] = asm["stackSave"];
var dynCall_ii = Module["dynCall_ii"] = asm["dynCall_ii"];
var dynCall_iii = Module["dynCall_iii"] = asm["dynCall_iii"];
var dynCall_iiii = Module["dynCall_iiii"] = asm["dynCall_iiii"];
var dynCall_v = Module["dynCall_v"] = asm["dynCall_v"];
var dynCall_vi = Module["dynCall_vi"] = asm["dynCall_vi"];
var dynCall_viiii = Module["dynCall_viiii"] = asm["dynCall_viiii"];
var dynCall_viiiii = Module["dynCall_viiiii"] = asm["dynCall_viiiii"];
var dynCall_viiiiii = Module["dynCall_viiiiii"] = asm["dynCall_viiiiii"];
;



// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;















































































var calledRun;


/**
 * @constructor
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
}

var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};





/** @type {function(Array=)} */
function run(args) {
  args = args || arguments_;

  if (runDependencies > 0) {
    return;
  }


  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();


    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
}
Module['run'] = run;


function exit(status, implicit) {

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && noExitRuntime && status === 0) {
    return;
  }

  if (noExitRuntime) {
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  quit_(status, new ExitStatus(status));
}

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  what += '';
  out(what);
  err(what);

  ABORT = true;
  EXITSTATUS = 1;

  throw 'abort(' + what + '). Build with -s ASSERTIONS=1 for more info.';
}
Module['abort'] = abort;

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  noExitRuntime = true;

run();





// {{MODULE_ADDITIONS}}



 
/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

// EXPORT_ES6 option does not work as described at
// https://github.com/kripken/emscripten/issues/6284, so we have to
// manually add this by '--post-js' setting when the Emscripten compilation.
export default Module;
