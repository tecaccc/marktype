// Mock for katex library in tests
export default {
  render: jest.fn(),
  renderToString: jest.fn().mockReturnValue(''),
};
