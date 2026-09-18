export const projectFixture = Object.freeze({
  school: '湘江实验学校', grade: '六年级', destination: '韶山', startDate: '2026-09-11', endDate: '2026-09-12',
  classes: [
    { id: 'class-1', name: '六年级1班', total: 42, boys: 21, girls: 21 },
    { id: 'class-2', name: '六年级2班', total: 43, boys: 22, girls: 21 },
    { id: 'class-3', name: '六年级3班', total: 41, boys: 20, girls: 21 }
  ],
  vehicles: [{ id: 'vehicle-1', capacity: 49 }, { id: 'vehicle-2', capacity: 49 }, { id: 'vehicle-3', capacity: 45 }],
  rooms: [{ type: '男生房', rooms: 11, capacity: 4 }, { type: '女生房', rooms: 11, capacity: 4 }],
  meals: [{ name: '第一天午餐', seatsPerTable: 10 }, { name: '第一天晚餐', seatsPerTable: 10 }]
});
