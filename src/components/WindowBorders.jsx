import React from 'react';
import ResizeBorder from './ResizeBorder';

const WindowBorders = ({ appWindow }) => {
  return (
    <>
      <ResizeBorder windowObj={appWindow} cursor="n-resize" direction="North" style={{
        top: 0,
        left: 12,
        right: 12,
        height: '6px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="s-resize" direction="South" style={{
        bottom: 0,
        left: 12,
        right: 12,
        height: '8px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="e-resize" direction="East" style={{
        top: 12,
        bottom: 12,
        right: 0,
        width: '6px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="w-resize" direction="West" style={{
        top: 12,
        bottom: 12,
        left: 0,
        width: '6px'
      }} />
      <ResizeBorder windowObj={appWindow} cursor="nw-resize" direction="NorthWest" style={{
        top: 0,
        left: 0,
        width: '14px',
        height: '14px',
        zIndex: 10001
      }} />
      <ResizeBorder windowObj={appWindow} cursor="ne-resize" direction="NorthEast" style={{
        top: 0,
        right: 0,
        width: '14px',
        height: '14px',
        zIndex: 10001
      }} />
      <ResizeBorder windowObj={appWindow} cursor="sw-resize" direction="SouthWest" style={{
        bottom: 0,
        left: 0,
        width: '14px',
        height: '14px',
        zIndex: 10001
      }} />
      <ResizeBorder windowObj={appWindow} cursor="se-resize" direction="SouthEast" style={{
        bottom: 0,
        right: 0,
        width: '14px',
        height: '14px',
        zIndex: 10001
      }} />
    </>
  );
};

export default WindowBorders;
