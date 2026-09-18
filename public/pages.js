export const navigationGroups = [
  { label: '今日工作台', pages: [{ id: 'P01', path: '/', title: '今日工作台', description: '近期项目、待办、异常和证件提醒' }] },
  { label: '研学项目', pages: [
    { id: 'P02', path: '/projects', title: '研学项目列表', description: '查找项目、查看状态并进入执行' },
    { id: 'P03', path: '/projects/new', title: '新建与编辑项目', description: '以最少信息建立项目并逐步补全' },
    { id: 'P04', path: '/projects/overview', title: '项目执行总览', description: '项目进度、异常、条件模块与下一步' },
    { id: 'P05', path: '/projects/people', title: '班级与人员汇总', description: '统一人数和随团人员来源' },
    { id: 'P06', path: '/projects/recruitment', title: '招募通知与接龙导入', description: '复制通知并导入最终接龙文本' },
    { id: 'P07', path: '/projects/guides', title: '导游安排', description: '档期检查、班级分配、退团与替换' },
    { id: 'P08', path: '/projects/transport', title: '乘车安排', description: '车辆、司机、乘员与容量校验' },
    { id: 'P09', path: '/projects/lodging', title: '住宿安排', description: '仅在项目需要住宿时出现', conditional: 'lodging' },
    { id: 'P10', path: '/projects/meals', title: '用餐安排', description: '仅在项目含餐时出现', conditional: 'meals' }
  ]},
  { label: '资料导入', pages: [
    { id: 'P11', path: '/imports', title: '资料导入', description: '文件或文字先进入临时解析区' },
    { id: 'P12', path: '/imports/mapping', title: '字段映射与导入预览', description: '人工确认后再写入正式数据' }
  ]},
  { label: '学校库', pages: [{ id: 'P13', path: '/schools', title: '学校库', description: '跨项目复用学校和常用联系人' }] },
  { label: '导游库', pages: [
    { id: 'P14', path: '/guides', title: '导游库', description: '合作与证件状态查询' },
    { id: 'P15', path: '/guides/detail', title: '导游详情', description: '证件、合作状态和事实记录' }
  ]},
  { label: '表格中心', pages: [
    { id: 'P16', path: '/tables', title: '表格中心', description: '检查可导出状态和阻断原因' },
    { id: 'P17', path: '/tables/preview', title: '预览与导出', description: '核对字段、合计和快照版本' }
  ]},
  { label: '异常与记录', pages: [
    { id: 'P18', path: '/exceptions', title: '异常中心', description: '定位并处理阻断、警告和提醒' },
    { id: 'P19', path: '/records', title: '操作与导入导出记录', description: '追查资料来源和关键操作' }
  ]},
  { label: '数据备份', pages: [{ id: 'P20', path: '/backup', title: '数据备份与恢复', description: '备份和恢复 SQLite 与证件目录' }] }
];

export const pages = navigationGroups.flatMap((group) => group.pages);

export function findPage(pathname) {
  return pages.find((page) => page.path === pathname) ?? null;
}
