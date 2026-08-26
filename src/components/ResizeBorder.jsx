import React from "react";

const ResizeBorder = ({ cursor, direction, style, windowObj }) => (
  <div 
    style={{ position: 'absolute', zIndex: 9999, cursor, background: 'rgba(0,0,0,0.01)', ...style }}
    onMouseDown={() => windowObj.startResizeDragging(direction).catch(()=>windowObj.startResizeDragging(direction.toLowerCase()).catch(()=>{}))}
  />
);

export default ResizeBorder;
