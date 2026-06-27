/**
 * PhotoGongju — 语言切换
 * 所有页面共用，独立于 main.js 避免依赖冲突
 */
(function () {
    'use strict';

    window.switchLang = function (lang) {
        var d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        document.cookie = 'lang=' + lang + ';path=/;expires=' + d.toUTCString() + ';SameSite=Lax';
        location.reload();
    };
})();
