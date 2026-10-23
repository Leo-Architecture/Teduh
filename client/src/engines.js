// The app engines are plain scripts shared with the classic page. Importing them runs them and puts
// Logic, Wx, Nav, Api, TMap and Sample on window. They are tested on their own (npm test).
import '../../public/js/sample.js';
import '../../public/js/logic.js';
import '../../public/js/wx.js';
import '../../public/js/nav.js';
import '../../public/js/api.js';
import '../../public/js/map.js';

export const L = window.Logic;
export const Wx = window.Wx;
export const Nav = window.Nav;
export const Api = window.Api;
export const TMap = window.TMap;
export const Sample = window.Sample;
