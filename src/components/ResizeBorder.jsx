import React from "react";

const ResizeBorder = ({ cursor, direction, style, windowObj }) => (
  <div 
    style={{ 
      position: 'absolute', 
      zIndex: 10000, 
      cursor, 
      background: 'transparent',
      userSelect: 'none',
      ...style 
    }}
    onMouseDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      windowObj?.startResizeDragging(direction).catch((err) => {
        console.error(`Failed to resize window (${direction}):`, err);
      });
    }}
  />
);

export default ResizeBorder;
