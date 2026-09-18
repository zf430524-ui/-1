const field = (key, label, options = {}) => ({ key, label, required: false, type: 'text', aliases: [], ...options });

export const importTargets = Object.freeze({
  schools: {
    key: 'schools', label: '学校资料', requiresProject: false, writable: true,
    fields: [
      field('name', '学校名称', { required: true, aliases: ['学校', '校名', '学校全称'] }),
      field('cooperationNotes', '合作备注', { aliases: ['备注', '学校备注'] }),
      field('contactName', '联系人姓名', { aliases: ['联系人', '默认联系人', '老师姓名'] }),
      field('contactPhone', '联系人电话', { type: 'phone', aliases: ['联系电话', '手机号', '手机号码', '电话'] }),
      field('contactNotes', '联系人备注', { aliases: ['联系人职务', '职务'] }),
      field('isDefault', '是否默认联系人', { type: 'boolean', aliases: ['默认联系人', '是否默认', '默认'] })
    ]
  },
  classes_teachers: {
    key: 'classes_teachers', label: '班级与老师', requiresProject: true, writable: false,
    fields: [
      field('className', '班级名称', { required: true, aliases: ['班级', '班级名'] }),
      field('studentTotal', '学生总数', { required: true, type: 'integer', aliases: ['学生人数', '总人数'] }),
      field('boys', '男生人数', { required: true, type: 'integer', aliases: ['男生', '男'] }),
      field('girls', '女生人数', { required: true, type: 'integer', aliases: ['女生', '女'] }),
      field('guideRequired', '所需导游数', { type: 'integer', aliases: ['导游人数', '需导游'] }),
      field('teacherRole', '老师角色', { aliases: ['教师角色', '职务'] }),
      field('teacherName', '老师姓名', { aliases: ['教师姓名', '带队老师'] }),
      field('teacherPhone', '老师电话', { type: 'phone', aliases: ['教师电话', '联系电话'] }),
      field('teacherGender', '老师性别', { aliases: ['教师性别', '性别'] }),
      field('ridesVehicle', '是否乘车', { type: 'boolean', aliases: ['乘车'] }),
      field('needsLodging', '是否住宿', { type: 'boolean', aliases: ['住宿'] }),
      field('joinsMeals', '默认参加用餐', { type: 'boolean', aliases: ['参加用餐', '用餐'] })
    ]
  },
  guide_recruitment: {
    key: 'guide_recruitment', label: '导游接龙', requiresProject: true, writable: false,
    fields: [
      field('sequence', '接龙序号', { required: true, type: 'integer', aliases: ['序号', '编号'] }),
      field('name', '导游姓名', { required: true, aliases: ['姓名', '导游'] }),
      field('phone', '导游手机号', { type: 'phone', aliases: ['手机号', '手机号码', '电话', '联系电话'] })
    ]
  },
  transport: {
    key: 'transport', label: '乘车资料', requiresProject: true, writable: false,
    fields: [
      field('vehicleLabel', '车号', { required: true, aliases: ['车辆', '车辆编号'] }),
      field('fleetName', '车队名称', { aliases: ['车队'] }),
      field('vehicleModel', '车辆型号', { aliases: ['车型'] }),
      field('capacity', '可用座位数', { required: true, type: 'integer', aliases: ['座位数', '容量'] }),
      field('plateNumber', '车牌号', { aliases: ['车牌'] }),
      field('driverName', '司机姓名', { required: true, aliases: ['司机'] }),
      field('driverPhone', '司机电话', { required: true, type: 'phone', aliases: ['联系电话', '手机号'] }),
      field('driverGender', '司机性别', { aliases: ['性别'] }),
      field('driverNeedsLodging', '司机是否住宿', { type: 'boolean', aliases: ['是否住宿', '住宿'] }),
      field('driverJoinsMeals', '司机默认用餐', { type: 'boolean', aliases: ['是否用餐', '用餐'] }),
      field('notes', '备注')
    ]
  },
  lodging: {
    key: 'lodging', label: '住宿资料', requiresProject: true, writable: false,
    fields: [
      field('lodgingName', '住宿点', { required: true, aliases: ['酒店', '住宿名称'] }),
      field('checkInOn', '入住日期', { required: true, type: 'date', aliases: ['日期'] }),
      field('building', '楼栋', { aliases: ['栋'] }),
      field('floorLabel', '楼层', { aliases: ['层'] }),
      field('roomNumber', '房号', { required: true, aliases: ['房间号'] }),
      field('roomType', '房型', { required: true, aliases: ['类型'] }),
      field('capacity', '床位数', { required: true, type: 'integer', aliases: ['容量'] }),
      field('genderRule', '性别规则', { required: true, aliases: ['性别'] }),
      field('notes', '备注')
    ]
  },
  meals: {
    key: 'meals', label: '用餐资料', requiresProject: true, writable: false,
    fields: [
      field('sessionName', '餐次', { required: true, aliases: ['名称'] }),
      field('restaurantName', '餐厅名称', { required: true, aliases: ['餐厅'] }),
      field('mealAt', '用餐时间', { required: true, type: 'datetime', aliases: ['时间'] }),
      field('seatsPerTable', '每桌人数', { required: true, type: 'integer', aliases: ['每桌标准人数'] }),
      field('bookedTables', '预订桌数', { required: true, type: 'integer', aliases: ['桌数'] }),
      field('notes', '备注')
    ]
  }
});

function normalizedHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-—–:：()（）/\\]+/g, '');
}

export function getImportTarget(key) {
  return importTargets[key] || null;
}

export function publicTargetCatalog() {
  return Object.values(importTargets).map(({ key, label, requiresProject, writable, fields }) => ({
    key, label, requiresProject, writable,
    fields: fields.map(({ key: fieldKey, label: fieldLabel, required, type }) => ({ key: fieldKey, label: fieldLabel, required, type }))
  }));
}

export function suggestMapping(headers, target) {
  const used = new Set();
  return Object.fromEntries(headers.map((header) => {
    const source = normalizedHeader(header);
    const match = target.fields.find((candidate) => {
      if (used.has(candidate.key)) return false;
      return [candidate.label, candidate.key, ...candidate.aliases].some((alias) => normalizedHeader(alias) === source);
    });
    if (match) used.add(match.key);
    return [header, match?.key || ''];
  }));
}

export function convertFieldValue(value, type) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (type === 'integer') {
    const number = Number(text.replace(/,/g, ''));
    return Number.isInteger(number) ? number : text;
  }
  if (type === 'boolean') {
    if (/^(1|true|是|有|参加|默认|需要)$/i.test(text)) return true;
    if (/^(0|false|否|无|不参加|非默认|不需要)$/i.test(text)) return false;
  }
  if (type === 'date' || type === 'datetime') {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.valueOf())) return type === 'date' ? parsed.toISOString().slice(0, 10) : parsed.toISOString();
  }
  return text;
}
