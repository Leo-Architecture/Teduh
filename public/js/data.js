// Sample township data. Edit NODES (places) and EDGE_DEFS (roads) to change the map.
// All values are invented for the demo.

const NODES = {
  home:{x:36,y:46,name:'Residences',place:true},
  a:{x:112,y:38},
  clinic:{x:184,y:50,name:'Clinic',place:true},
  b:{x:256,y:40},
  market:{x:326,y:52,name:'Market',place:true},
  c:{x:44,y:152},
  d:{x:116,y:146},
  plaza:{x:186,y:158,name:'Plaza',place:true},
  f:{x:254,y:150},
  g:{x:322,y:158},
  bus:{x:38,y:258,name:'Bus stop',place:true},
  h:{x:112,y:252},
  park:{x:184,y:262,name:'Park',place:true},
  i:{x:252,y:254},
  school:{x:326,y:264,name:'School',place:true}
};
// id, from, to, road, where, shade (0-1), covered walkway, floods at (mm/h), blocked drain
const EDGE_DEFS = [
  ['e01','home','a','Jalan Seri','Jalan Seri near Residences',0.7,0,90,0],
  ['e02','a','clinic','Jalan Seri','Jalan Seri by the Clinic',0.6,1,90,0],
  ['e03','clinic','b','Jalan Seri','Jalan Seri east of Clinic',0.5,0,90,0],
  ['e04','b','market','Jalan Seri','Jalan Seri at the Market arcade',0.3,1,90,0],
  ['e05','c','d','Jalan Lembah','Jalan Lembah west',0.1,0,55,0],
  ['e06','d','plaza','Jalan Lembah','Jalan Lembah near Plaza',0.15,0,28,1],
  ['e07','plaza','f','Jalan Lembah','Jalan Lembah east of Plaza',0.1,0,40,0],
  ['e08','f','g','Jalan Lembah','Jalan Lembah near Market',0.2,0,55,0],
  ['e09','bus','h','Jalan Taman','Jalan Taman near Bus stop',0.5,0,80,0],
  ['e10','h','park','Jalan Taman','Jalan Taman by the Park',0.8,0,80,0],
  ['e11','park','i','Jalan Taman','Jalan Taman east of Park',0.8,0,75,0],
  ['e12','i','school','Jalan Taman','Jalan Taman at School gate',0.4,1,80,0],
  ['e13','home','c','Lorong Pokok','Lorong Pokok north',0.8,0,85,0],
  ['e14','c','bus','Lorong Pokok','Lorong Pokok south',0.6,0,75,0],
  ['e15','a','d','Lorong Bukit','Lorong Bukit north',0.4,0,85,0],
  ['e16','d','h','Lorong Bukit','Lorong Bukit south',0.3,0,65,0],
  ['e17','clinic','plaza','Jalan Pusat','Jalan Pusat north',0.2,1,60,0],
  ['e18','plaza','park','Jalan Pusat','Jalan Pusat south',0.3,0,38,0],
  ['e19','b','f','Lorong Cahaya','Lorong Cahaya north',0.1,0,80,0],
  ['e20','f','i','Lorong Cahaya','Lorong Cahaya south',0.1,0,45,0],
  ['e21','market','g','Jalan Pasar','Jalan Pasar north',0.2,0,70,0],
  ['e22','g','school','Jalan Pasar','Jalan Pasar south',0.15,0,50,0]
];
