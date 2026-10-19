"""CSP compatibility patch for bundled Emscripten bindings in vosk-browser 0.0.8.
Run once after copying the original vosk.js. No WASM/model/recognition changes.
"""
import base64
import re
from pathlib import Path

path = Path(__file__).with_name('vosk.js')
source = path.read_text()
encoded = max(re.findall(r'[A-Za-z0-9+/=]{1000,}', source), key=len)
worker = base64.b64decode(encoded).decode()
replacements = [
    ('function createNamedFunction(', 'var emval_free_list=', '''function createNamedFunction(name,body){
      var wrapper=function(){return body.apply(this,arguments)};
      Object.defineProperty(wrapper,"name",{value:makeLegalFunctionName(name)});
      return wrapper;
    }'''),
    ('function craftInvokerFunction(', 'function heap32VectorToArray(', '''function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
      var argCount=argTypes.length;
      if(argCount<2)throwBindingError("argTypes array size mismatch");
      var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
      var needsDestructorStack=argTypes.slice(1).some(function(t){return t!==null&&t.destructorFunction===undefined});
      return createNamedFunction(humanName,function(){
        if(arguments.length!==argCount-2)throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+(argCount-2));
        var destructors=needsDestructorStack?[]:null;
        var wired=[cppTargetFunc];
        if(isClassMethodFunc)wired.push(argTypes[1].toWireType(destructors,this));
        for(var i=0;i<arguments.length;i++)wired.push(argTypes[i+2].toWireType(destructors,arguments[i]));
        var rv=cppInvokerFunc.apply(null,wired);
        if(needsDestructorStack)runDestructors(destructors);
        else for(var i=isClassMethodFunc?1:2;i<argCount;i++){
          if(argTypes[i].destructorFunction!==null)argTypes[i].destructorFunction(wired[i-(isClassMethodFunc?0:1)]);
        }
        if(argTypes[0].name!=="void")return argTypes[0].fromWireType(rv);
      });
    }'''),
    ('function __emval_get_method_caller(', 'function __emval_incref(', '''function __emval_get_method_caller(argCount,argTypes){
      var types=__emval_lookupTypes(argCount,argTypes),retType=types[0];
      return __emval_addMethodCaller(function(handle,name,destructors,args){
        var values=[],offset=0;
        for(var i=1;i<argCount;i++){
          values.push(types[i].readValueFromPointer(args+offset));
          offset+=types[i].argPackAdvance;
        }
        var rv=handle[name].apply(handle,values);
        for(var i=1;i<argCount;i++)if(types[i].deleteObject)types[i].deleteObject(values[i-1]);
        if(!retType.isVoid)return retType.toWireType(destructors,rv);
      });
    }''')
]
for start, end, replacement in replacements:
    a=worker.index(start)
    b=worker.index(end,a)
    worker=worker[:a]+replacement+worker[b:]
# Decode the bundled data URI directly instead of attempting a CSP-blocked fetch.
worker = worker.replace('function getBinaryPromise(){if(!wasmBinary&&(ENVIRONMENT_IS_WORKER))', 'function getBinaryPromise(){if(!wasmBinary&&!isDataURI(wasmBinaryFile)&&(ENVIRONMENT_IS_WORKER))')
assert 'new Function' not in worker and 'new_(Function' not in worker
path.write_text(source.replace(encoded,base64.b64encode(worker.encode()).decode()))
