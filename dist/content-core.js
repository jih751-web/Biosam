(function(root){
  'use strict';
  const categories=['활동 기록','SEM 갤러리','교육 자료','자유 나눔','질문과 답변'];
  const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',hwp:'application/x-hwp',hwpx:'application/vnd.hancom.hwpx'};
  function validateFiles(files){
    if(files.length>5)throw Error('첨부 파일은 최대 5개까지 선택해 주세요.');
    return Array.from(files).map(file=>{
      const extension=file.name.split('.').pop().toLowerCase();
      if(!types[extension]||file.name.length>200)throw Error('첨부 파일 형식을 확인해 주세요. 사진·PDF·한글·Office 문서만 가능합니다.');
      if(!Number.isFinite(file.size)||file.size<=0||file.size>10*1024*1024)throw Error('첨부 파일은 비어 있지 않은 10MB 이하 파일이어야 합니다.');
      return {file,extension,mime:types[extension]};
    });
  }
  function validatePost(input){const post={category:String(input.category||''),title:String(input.title||'').trim(),body:String(input.body||'').trim()};if(!categories.includes(post.category))throw Error('분류를 확인해 주세요.');if(post.title.length<2||post.title.length>120)throw Error('제목은 2~120자로 입력해 주세요.');if(post.body.length<2||post.body.length>10000)throw Error('내용은 2~10000자로 입력해 주세요.');return post;}
  const api={categories,types,validateFiles,validatePost,destination:c=>({'활동 기록':'activities','SEM 갤러리':'gallery','교육 자료':'resources'}[c]||'community')};
  root.BioSEMContentCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
