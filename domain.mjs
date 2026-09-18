export const seedState = {
  project: {
    id: 'p-0923', name: '湘江实验学校 · 初一研学团', school: '湘江实验学校', grade: '初一',
    startDate: '2026-09-23', endDate: '2026-09-24', meeting: '07:10 学校东门集合',
    manager: '田主管', status: '编排中', guideNeed: 3, safetySeats: 0
  },
  classes: [
    { id: 'c1', name: '初一（1）班', students: 42, male: 20, female: 22, teachers: 2, guideId: 'g1', guide: '向晴', guideStatus: '已确认', vehicle: '湘A·K2198' },
    { id: 'c2', name: '初一（2）班', students: 39, male: 17, female: 22, teachers: 2, guideId: 'g3', guide: '周昕', guideStatus: '待确认', vehicle: '湘A·R5682' },
    { id: 'c3', name: '初一（3）班', students: 36, male: 18, female: 18, teachers: 2, guideId: 'g2', guide: '李萱', guideStatus: '待审核', vehicle: '湘A·M8830' }
  ],
  vehicles: [
    { id: 'v1', plate: '湘A·K2198', model: '49座大巴', capacity: 49, status: '已安排' },
    { id: 'v2', plate: '湘A·R5682', model: '49座大巴', capacity: 49, status: '已安排' },
    { id: 'v3', plate: '湘A·M8830', model: '49座大巴', capacity: 49, status: '已安排' },
    { id: 'v4', plate: '湘A·B0231', model: '29座小巴', capacity: 29, status: '备用' }
  ],
  applicants: [
    { id: 'g1', name: '向晴', phone: '138****2086', status: '已确认', complete: true, note: '带初中团 12 次' },
    { id: 'g2', name: '李萱', phone: '156****4012', status: '待审核', complete: true, note: '报名于 09-05 10:12' },
    { id: 'g3', name: '周昕', phone: '186****7621', status: '待确认', complete: true, note: '等待本人确认' },
    { id: 'g4', name: '张衡', phone: '151****3389', status: '待确认', complete: true, note: '存在已确认档期' }
  ],
  confirmedAssignments: [
    { guideId: 'g4', projectId: 'p-old', projectName: '岳麓区博物馆研学团', startDate: '2026-09-23', endDate: '2026-09-23', status: '已确认' }
  ],
  rooms: [
    { id: 'm301', no: '301', gender: '男生', capacity: 4, occupants: 4, classes: '初一（1）班' },
    { id: 'm302', no: '302', gender: '男生', capacity: 4, occupants: 4, classes: '初一（1）班' },
    { id: 'm303', no: '303', gender: '男生', capacity: 4, occupants: 4, classes: '初一（1）班' },
    { id: 'm304', no: '304', gender: '男生', capacity: 4, occupants: 4, classes: '初一（1）班 / 初一（2）班', mixedClass: true },
    { id: 'm305', no: '305', gender: '男生', capacity: 4, occupants: 4, classes: '初一（2）班' },
    { id: 'm306', no: '306', gender: '男生', capacity: 4, occupants: 4, classes: '初一（2）班 / 初一（3）班', mixedClass: true },
    { id: 'm307', no: '307', gender: '男生', capacity: 4, occupants: 3, classes: '初一（3）班' },
    { id: 'f401', no: '401', gender: '女生', capacity: 4, occupants: 4, classes: '初一（1）班' },
    { id: 'f402', no: '402', gender: '女生', capacity: 4, occupants: 4, classes: '初一（1）班' },
    { id: 'f403', no: '403', gender: '女生', capacity: 4, occupants: 4, classes: '初一（1）班 / 初一（2）班', mixedClass: true },
    { id: 'f404', no: '404', gender: '女生', capacity: 4, occupants: 4, classes: '初一（2）班' },
    { id: 'f405', no: '405', gender: '女生', capacity: 4, occupants: 4, classes: '初一（2）班' },
    { id: 'f406', no: '406', gender: '女生', capacity: 4, occupants: 4, classes: '初一（2）班 / 初一（3）班', mixedClass: true },
    { id: 'f407', no: '407', gender: '女生', capacity: 4, occupants: 4, classes: '初一（3）班' },
    { id: 'f408', no: '408', gender: '女生', capacity: 4, occupants: 2, classes: '初一（3）班' }
  ],
  requests: [
    { id: 'r1', type: '确认提醒', guide: '周昕', detail: '请于今日 18:00 前确认接团', level: '待处理' },
    { id: 'r2', type: '车辆信息待补齐', guide: '—', detail: '湘A·M8830 司机电话未录入', level: '需确认' }
  ]
};

export const dateOverlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

export function validateClassCounts(classes) {
  return classes.map(item => ({ ...item, valid: item.students === item.male + item.female }));
}

export function vehicleAssignments(classes, vehicles, safetySeats = 0) {
  return classes.map(item => {
    const vehicle = vehicles.find(v => v.plate === item.vehicle);
    const people = item.students + item.teachers + (item.guide ? 1 : 0);
    const available = vehicle ? vehicle.capacity - safetySeats : 0;
    return { className: item.name, vehicle: vehicle?.plate || '未安排', people, available, spare: available - people, valid: Boolean(vehicle) && people <= available };
  });
}

export function validateRooms(rooms) {
  return rooms.map(room => ({ ...room, valid: room.occupants <= room.capacity, mixedClass: Boolean(room.mixedClass) }));
}

export function confirmGuide(state, guideId) {
  const guide = state.applicants.find(item => item.id === guideId);
  if (!guide) return { ok: false, reason: '未找到导游记录。' };
  const conflict = state.confirmedAssignments.find(item => item.guideId === guideId && item.status === '已确认' && dateOverlaps(state.project.startDate, state.project.endDate, item.startDate, item.endDate));
  if (conflict) return { ok: false, reason: `无法确认：${conflict.projectName}（${conflict.startDate}）已占用该导游档期。` };
  guide.status = '已确认';
  guide.note = '本人已确认，档期已锁定';
  const assignedClass = state.classes.find(item => item.guideId === guideId);
  if (assignedClass) assignedClass.guideStatus = '已确认';
  state.confirmedAssignments.push({ guideId, projectId: state.project.id, projectName: state.project.name, startDate: state.project.startDate, endDate: state.project.endDate, status: '已确认' });
  if (Array.isArray(state.requests)) state.requests = state.requests.filter(item => !(item.guide === guide.name && item.type.includes('确认')));
  const confirmedCount = state.applicants.filter(item => item.status === '已确认').length;
  if (confirmedCount >= state.project.guideNeed) {
    state.applicants.filter(item => item.status === '待确认' && !state.classes.some(classItem => classItem.guideId === item.id)).forEach(item => {
      item.status = '候补';
      item.note = '正式名额已满，进入候补名单';
    });
  }
  return { ok: true, reason: `${guide.name} 已确认，档期已锁定。` };
}

export function toCsv(state) {
  const rows = [['项目', '班级', '学生人数', '班主任及老师', '导游', '车牌', '乘车总人数', '空余座位']];
  const assignments = vehicleAssignments(state.classes, state.vehicles, state.project.safetySeats);
  state.classes.forEach((item, index) => rows.push([state.project.name, item.name, item.students, item.teachers, item.guide, item.vehicle, assignments[index].people, assignments[index].spare]));
  return '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
