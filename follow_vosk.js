/* Offline Vosk adapter. Audio exists only in memory on this device. */
(function(root){
  'use strict';
  var USE_GRAMMAR = false;
  var modelPromise;
  async function load(status){
    if(!modelPromise) modelPromise=(async function(){
      var response=await fetch('model/vosk-model-small-ru-0.22.tar.gz');
      if(!response.ok) throw Error('Не удалось загрузить модель распознавания');
      var reader=response.body.getReader(), chunks=[], size=0;
      for(;;){var part=await reader.read();if(part.done)break;chunks.push(part.value);size+=part.value.length;status('Загружаю распознавание: '+Math.round(size/1048576)+' из 46 МБ');}
      status('Подготавливаю распознавание на телефоне…');
      var url=URL.createObjectURL(new Blob(chunks));
      try{return await Vosk.createModel(url);}finally{URL.revokeObjectURL(url);}
    })().catch(function(e){modelPromise=null;throw e;});
    status('Загружаю распознавание…');
    return modelPromise;
  }
  function create(opts){
    var core=FollowCore.create({tokens:opts.tokens,cues:opts.cues,window:20,eager:true});
    var stopped=false,stream,ctx,source,node,rec;
    function stop(){stopped=true;if(stream)stream.getTracks().forEach(function(t){t.stop();});if(node){node.disconnect();node.onaudioprocess=null;}if(source)source.disconnect();if(ctx)ctx.close().catch(function(){});if(rec){rec.remove();rec=null;}}
    function feed(text,final){if(!stopped)core.feed(text,final).forEach(opts.onEvent);}
    async function start(){
      try{
        if(!isSecureContext || !navigator.mediaDevices) throw Error('Для микрофона откройте страницу через HTTPS или localhost.');
        var model=await load(opts.onStatus);if(stopped)return;
        stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
        if(stopped){stream.getTracks().forEach(function(t){t.stop();});return;}
        ctx=new AudioContext();await ctx.resume();
        // Полный словарь модели, без грамматики из слов сказки: офлайн-замер 19.10 (SP1_eval/REPORT.md) —
        // с грамматикой 52 % меток вовремя (модель подгоняет любой звук под слова сказки, позиция убегает вперёд),
        // с полным словарём 87,5 % на чистой речи.
        rec=USE_GRAMMAR?new model.KaldiRecognizer(ctx.sampleRate,JSON.stringify(Array.from(new Set(opts.tokens)).concat('[unk]'))):new model.KaldiRecognizer(ctx.sampleRate);
        rec.on('partialresult',function(m){feed(m.result.partial,false);});
        rec.on('result',function(m){feed(m.result.text,true);});
        source=ctx.createMediaStreamSource(stream);
        if(ctx.audioWorklet){
          await ctx.audioWorklet.addModule('follow_worklet.js');if(stopped)return;
          node=new AudioWorkletNode(ctx,'sp1-microphone');
          node.port.onmessage=function(e){if(!stopped && rec)rec.acceptWaveformFloat(e.data,ctx.sampleRate);};
        }else{
          node=ctx.createScriptProcessor(4096,1,1);
          node.onaudioprocess=function(e){if(!stopped)rec.acceptWaveform(e.inputBuffer);};
        }
        source.connect(node);node.connect(ctx.destination);
        opts.onStatus('слушаю');opts.onReady();
      }catch(e){stop();opts.onError(e && e.name==='NotAllowedError' ? 'Нет доступа к микрофону. Разрешите его в настройках сайта.' : 'Не удалось включить слушание: '+(e && e.message || 'Модель недоступна. Проверьте загрузку файлов и попробуйте снова.'));}
    }
    return {core:core,start:start,stop:stop};
  }
  root.FollowVosk={create:create};
})(window);
