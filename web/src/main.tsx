import { createRoot } from 'react-dom/client';
// 글꼴은 빌드 결과물에 함께 넣는다. 외부 CDN 없이 폐쇄망에서도 같은 화면이 나온다(모두 OFL).
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
