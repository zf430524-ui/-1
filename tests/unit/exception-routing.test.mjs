import test from 'node:test';
import assert from 'node:assert/strict';
import { exceptionActionPath } from '../../src/services/business.mjs';

test('异常定位路径按来源模块进入对应项目页并保留源对象', () => {
  assert.equal(exceptionActionPath({ id: 'e1', project_id: 'p1', module: '乘车', source_id: 'vehicle-1' }), '/projects/transport?project=p1&focus=vehicle-1&exception=e1');
  assert.equal(exceptionActionPath({ id: 'e2', project_id: 'p1', module: '项目', source_id: 'p1' }), '/projects/new?id=p1&exception=e2');
});
