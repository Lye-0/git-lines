import { expect, it } from 'vitest';
import { sidebarRefMode } from '../../webview/src/components/sidebarRefPresentation';

it('keeps full names until refs no longer fit even after shortening the subject', () => {
  expect(sidebarRefMode(3,150,149.5,24)).toEqual({mode:'names',visible:3});
  expect(sidebarRefMode(3,149,149.5,24)).toEqual({mode:'icons',visible:3});
});
it('uses type icons for a single long ref and for multiple refs', () => {
  expect(sidebarRefMode(1,60,400,24)).toEqual({mode:'icons',visible:1});
  expect(sidebarRefMode(3,68,400,24)).toEqual({mode:'icons',visible:3});
});
it('reserves room for the exact overflow count and preserves badge priority', () => {
  expect(sidebarRefMode(20,80,1000,24)).toEqual({mode:'icons',visible:2});
  expect(sidebarRefMode(200,80,10000,36)).toEqual({mode:'icons',visible:1});
  expect(sidebarRefMode(20,24,1000,24)).toEqual({mode:'icons',visible:0});
});
it('never exceeds its icon budget over many lengths and widths', () => {
  for(const count of [1,3,10,100])for(let width=24;width<=400;width++){
    const p=sidebarRefMode(count,width,10000,24);
    const required=p.visible*20+Math.max(0,p.visible-1)*4+(p.visible<count?24+(p.visible?4:0):0);
    expect(required).toBeLessThanOrEqual(width);
    expect(p.visible).toBeGreaterThanOrEqual(0);expect(p.visible).toBeLessThanOrEqual(count);
  }
});

it('switches to icons before the message collapses without reducing the icon budget', () => {
  expect(sidebarRefMode(5,140,130,24,90)).toEqual({mode:'icons',visible:5});
  expect(sidebarRefMode(5,140,130,24,130)).toEqual({mode:'names',visible:5});
});
