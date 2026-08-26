import React from 'react';
import ResizeBorder from './ResizeBorder';

const WindowBorders = ({ appWindow }) => {
  return (
    <>
      <ResizeBorder windowObj={appWindow} cursor="n-resize" direction="North" style={{
        top: 0,
        left: 4,
        right: 4,
        height: '4px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="s-resize" direction="South" style={{
        bottom: 0,
        left: 4,
        right: 4,
        height: '12px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="e-resize" direction="East" style={{
        top: 4,
        bottom: 4,
        right: 0,
        width: '4px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="w-resize" direction="West" style={{
        top: 4,
        bottom: 4,
        left: 0,
        width: '4px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="nw-resize" direction="NorthWest" style={{
        top: 0,
        left: 0,
        width: '8px',
        height: '8px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="ne-resize" direction="NorthEast" style={{
        top: 0,
        right: 0,
        width: '8px',
        height: '8px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="sw-resize" direction="SouthWest" style={{
        bottom: 0,
        left: 0,
        width: '8px',
        height: '8px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="se-resize" direction="SouthEast" style={{
        bottom: 0,
        right: 0,
        width: '8px',
        height: '8px'
      }} />
    </>
  );
};

export default WindowBorders;
