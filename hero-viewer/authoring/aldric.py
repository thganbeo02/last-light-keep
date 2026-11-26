from .mesh import *

def build():
    for hand in (-1,1):
        x=248+hand*96
        def leg(name,finish,rows):
            loft(name,finish,[(y,x+a if hand==-1 else x-b,x+b if hand==-1 else x-a,d,e) for y,a,b,d,e in rows])
        leg("Boot sole","leather",[(704,-61,56,1055,1220),(727,-62,57,1054,1221),(730,-58,54,1057,1217)])
        leg("Square toe and heel","leather",[(651,-34,32,1062,1147),(672,-45,44,1064,1179),(682,-51,50,1061,1207),(705,-54,53,1057,1212)])
        leg("Boot instep strap","leather",[(657,-33,30,1101,1154),(671,-42,40,1112,1181),(678,-41,40,1138,1188)])
        leg("Greave","iron",[(549,-27,35,1071,1159),(589,-28,36,1070,1157),(636,-36,39,1068,1143),(656,-34,34,1068,1149)])
        leg("Greave cuff","iron",[(626,-38,49,1067,1153),(631,-40,51,1063,1158),(657,-43,51,1061,1158),(663,-39,45,1065,1153)])
        leg("Quilted cuisse","leather",[(434,-18,63,1064,1159),(497,-16,59,1060,1161),(581,-34,35,1067,1154),(602,-31,32,1072,1150)])
        for y,offset,w in [(442,24,62),(479,18,63),(537,8,58)]:
            leg("Overlapping thigh lame","iron",[(y,offset-w/2+3,offset+w/2,1068,1161),(y+30,offset-w/2-6,offset+w/2-5,1062,1169),(y+40,offset-w/2-7,offset+w/2-7,1065,1165)])
    loft("Padded jack","dark",[(218,213,283,1103,1163),(255,167,330,1070,1178),(315,156,340,1057,1190),(404,178,315,1069,1180),(465,176,317,1075,1170)])
    # Rear tabard hangs below the shorter cloak, with little square breaks at the hem.
    rear_hem=[(205,595),(213,595),(214,613),(222,613),(222,602),(230,602),(231,623),(236,623),(237,632),(243,632),(245,617),(251,617),(253,627),(260,627),(261,610),(267,610),(268,598),(277,598),(278,625),(286,625),(288,590)]
    cloth("Back tabard","blue",[
        [(245+(x-245)*.83,402,1064) for x,y in rear_hem],
        [(x,519,1063+cos(x*.11)*3) for x,y in rear_hem],
        [(x,y,1098+cos(x*.11)*4) for x,y in rear_hem]],-5)
    # A broad back panel and overlapping cascades on the sword side have different depths.
    edge=[(140,411),(147,411),(148,432),(155,432),(157,415),(169,415),(171,448),(180,448),(182,437),(196,437),(196,452),(207,452),(209,491),(217,491),(218,480),(224,480),(225,507),(237,507),(238,526),(244,527),(244,499),(256,499),(257,487),(267,487),(268,505),(279,505),(281,463),(293,463),(295,450),(305,450),(306,469),(314,469),(316,446),(325,446),(328,466),(337,466),(339,429),(350,429),(352,409)]
    cloth("Blue cape, torn back panel","blue",[
        [(244+(x-244)*k,yp if t==0 else yp+(y-yp)*t,depth+18*((x-246)/110)**2+5*cos(x*.093)) for x,y in edge]
        for k,yp,t,depth in [(.65,237,0,1071),(.81,247,.20,1030),(.95,251,.58,1001),(1,250,1,980)]],-6)
    for layer,(x0,x1,z0,z1,ys) in enumerate([
        (18,113,1041,1079,[399,404,388,391,377,394,377,356]),
        (26,124,999,1069,[445,450,460,442,426,428,408,398]),
        (69,166,971,1044,[473,480,463,470,497,485,458,427]),
        (116,194,962,1032,[518,520,500,504,537,533,492,465]),
        (143,204,988,1043,[556,558,543,548,576,578,504,490])]):
        grid=[]
        for t in (0,.32,.67,.89,1):
            row=[]
            for i,end in enumerate(ys):
                u=i/(len(ys)-1)
                x=(119+69*u)*(1-t)+(x0+(x1-x0)*u)*t-23*sin(t*pi)
                y=(245+24*u)*(1-t)+end*t
                z=(1071+22*u)*(1-t)+(z0+(z1-z0)*u+4*(i%3))*t
                x+=9*(u-.5)*sin(t*pi)
                row.append((x,y,z))
            grid.append(row)
        cloth("Layered windblown cape tail","blue",grid,-7)
    # Sculpt the cowl in descending chevrons on the rear.
    for n in range(2):
        cloth("Folded cape collar","blue",[
            [(157,237+n*20,1112),(200,242+n*20,1053),(250,251+n*20,1040),(296,242+n*20,1053),(337,235+n*20,1112)],
            [(153,263+n*19,1107),(199,280+n*23,1043),(250,303+n*24,1031),(298,281+n*20,1044),(341,260+n*18,1109)]
        ],-5)
    cloth("Heraldic surcoat","blue",[
        [(182,267,1170),(208,260,1182),(249,266,1189),(290,260,1182),(311,270,1169)],
        [(188,328,1181),(207,327,1192),(249,327,1197),(292,327,1192),(309,325,1180)],
        [(194,414,1176),(211,415,1187),(250,414,1191),(289,415,1187),(306,413,1176)]])
    hem=[(218,616),(224,630),(231,629),(233,613),(244,615),(246,601),(255,601),(258,627),(268,627),(270,614),(277,616),(280,610),(289,610)]
    cloth("Torn tabard skirt","blue",[
        [(230+(x-218)*.68,432,1181+5*cos(x*.1)) for x,y in hem],
        [(221+(x-218)*.89,527,1189+6*cos(x*.1)) for x,y in hem],
        [(x,y,1195+5*cos(x*.1)) for x,y in hem]])
    loft("Sloped cuirass flank","iron",[(270,179,320,1089,1171),(320,164,326,1084,1183),(397,180,315,1088,1177)])
    loft("Sword belt","leather",[(397,178,316,1067,1184),(401,174,321,1063,1194),(435,174,320,1064,1194),(440,179,316,1069,1187)])
    loop("Brass belt buckle","gold",256,418,1199,37,35,4)
    block("Buckle tongue","gold",246,418,1201,13,5,5,1)
    for hand in (-1,1):
        def arm(name,finish,rows):
            loft(name,finish,[(y,min(248+hand*a,248+hand*b),max(248+hand*a,248+hand*b),d,e) for y,a,b,d,e in rows])
        # Arm bands follow the sheet: one column under the pauldron, each ring's
        # front and profile extents measured from the front and side views.
        arm("Leather sleeve","leather",[(249,52,123,1061,1160),(310,66,140,1066,1148),(380,88,152,1068,1134),(436,112,166,1070,1130)])
        for name,finish,rows,drop in [
            ("Domed pauldron","iron",[(218,64,93,1083,1131),(230,51,117,1068,1147),(250,44,145,1056,1160),(277,43,161,1052,1170),(287,47,163,1054,1167)],11),
            ("Pauldron bound lip","silver",[(268,45,158,1055,1169),(274,42,165,1050,1173),(289,45,168,1049,1172),(293,48,164,1055,1167)],11),
            ("Upper arm plate","iron",[(306,93,147,1066,1150),(312,89,153,1060,1155),(334,91,155,1060,1155),(341,95,151,1064,1151)],5),
            ("Elbow cop","iron",[(342,100,166,1064,1138),(348,93,176,1056,1142),(370,95,176,1056,1142),(378,101,170,1061,1137)],4),
            ("Vambrace","iron",[(375,113,170,1066,1136),(382,113,178,1062,1140),(398,113,178,1062,1140),(402,116,174,1066,1136)],3),
            ("Gauntlet cuff","silver",[(398,112,184,1062,1142),(404,108,191,1055,1147),(428,108,191,1055,1147),(434,113,186,1060,1142)],3)]:
            rings=[]
            for y,a,b,d,e in rows:
                r=ring(y,min(248+hand*a,248+hand*b),max(248+hand*a,248+hand*b),d,e)
                rings.append([(x,yy+drop*(abs(x-248)-a)/max(1,b-a),z) for x,yy,z in r])
            solid(name,finish,rings)
        # The fist hangs palm-inward. Curled fingers run inward along the bottom,
        # stacked front to back, and the thumb crosses in front of them with a gap
        # beside the knuckles.
        block("Gauntlet back","leather",248+hand*155,456,1108,64,54,72,5)
        block("Gauntlet knuckles","leather",248+hand*168,466,1124,42,30,50,4)
        for i,z in enumerate((1139,1121,1103,1085)):
            block("Curled gauntlet finger","leather",248+hand*(166-i),498+i,z,46,32,19,4)
        block("Gauntlet fingertips","leather",248+hand*137,495,1120,26,26,52,4)
        block("Gauntlet thumb","leather",248+hand*126,464,1132,30,48,32,5)
    for s in (-1,1):
        x=248+s*98
        solid("Pauldron lozenge","gold",[
            [(x,249,1160),(x+15,268,1160),(x,286,1160),(x-15,268,1160)],
            [(x,254,1167),(x+10,268,1167),(x,278,1167),(x-10,268,1167)],
            [(x-.7,265,1173),(x+2,268,1173),(x,270,1173),(x-2,268,1173)]])
    disc("Captain's cape clasp","gold",189,287,1193,24,13)
    loft("Gorget","blue",[(235,204,290,1088,1178),(247,190,302,1080,1186),(270,187,304,1080,1192),(296,213,282,1090,1190)])
    loft("Neck","skin",[(192,215,279,1104,1171),(253,213,282,1102,1172)])
    loft("Angular face","skin",[(100,213,275,1075,1173),(133,191,296,1065,1198),(161,187,301,1064,1201),(192,191,299,1074,1196),(220,202,289,1085,1195),(241,219,278,1099,1193)])
    for s in (-1,1):
        x=245+s*66
        block("Ear","skin",x,194,1143,23,41,33,5)
        block("Grey sideburn","hair",245+s*52,200,1169,15,45,22,4)
        b=[(202,156),(219,158),(241,166),(241,176),(222,174),(202,168)]
        plate("Heavy brow","hair",[(x if s==-1 else 493-x,y,1204+(x-221)*.05) for x,y in b],12)
    loft("Nose","skin",[(166,241,257,1190,1204),(185,240,260,1191,1220),(197,238,260,1194,1220),(201,244,258,1195,1212)])
    loft("Squared beard","hair",[(199,206,290,1092,1187),(211,198,297,1092,1199),(234,207,289,1104,1206),(246,219,278,1111,1201)])
    plate("Moustache","hair",[(214,211,1204),(219,204,1206),(239,201,1209),(249,203,1211),(262,201,1208),(277,205,1205),(282,216,1203),(271,213,1207),(250,212,1211),(225,214,1208),(215,222,1204)],7)
    # Each angular lock follows its own swept path from forehead to nape.
    loft("Hair mass","hair",[(71,225,261,1080,1158),(91,195,285,1052,1187),(119,170,311,1034,1192),(151,161,321,1023,1176),(175,176,310,1028,1159),(204,198,291,1040,1139),(226,214,279,1055,1127)])
    for x,w,top,front,rear in [(241,40,61,1207,1090),(265,30,69,1215,1075),(208,43,78,1199,1056),(283,31,84,1195,1048),(181,41,104,1180,1037),(301,34,104,1189,1034),(161,33,131,1158,1020),(318,30,131,1164,1024)]:
        rings=[]
        for t,dy,width in [(0,49,.80),(.09,41,1),(.18,19,1),(.48,5,1),(.73,5,.94),(.76,0,.94),(1,0,.9)]:
            zz=front+(rear-front)*t
            xx=x+(x-244)*(.024*t)
            falloff=np.interp(abs(x-244),[0,35,58,78],[1,.91,.55,.14])
            yy=top+dy*falloff
            ww=w*width
            rings.append([(xx-ww/2,yy+2,zz),(xx-ww*.38,yy,zz),(xx+ww*.38,yy,zz),(xx+ww/2,yy+2,zz),(xx+ww*.48,yy+18+3*falloff,zz),(xx-ww*.47,yy+18+3*falloff,zz)])
        solid("Swept crown lock","hair",rings)
    for s in (-1,1):
        for i in range(3):
            x=245+s*(59-i*9)
            loft("Nape lock","hair",[(144+i*12,x-15,x+17,1020+i*4,1123),(159+i*16,x-17,x+15,1019+i*5,1120),(174+i*19,x-11,x+9,1030+i*5,1099)])
        block("Silver temple streak","silverhair",245+s*65,158,1133,32,33,77,5)
    for idx,(name,material,faces) in enumerate(parts):
        if name in {"Boot sole","Square toe and heel","Boot instep strap","Greave","Greave cuff","Quilted cuisse","Overlapping thigh lame"}:
            for triangle in faces:
                near=triangle[:,0].mean()<248
                triangle[:,2]=1134+(triangle[:,2]-1134)*.915
                triangle[:,0]+=(-1 if near else 1)*np.clip((triangle[:,2]-1120)/11,0,7)
    # Sword axis is carried forward of the hip and slopes towards the outside of the knee.
    sword=[(182,377,1185),(173,408,1176),(161,437,1167),(145,492,1151),(120,585,1129),(116,601,1126)]
    tube("Leather scabbard","leather",sword[2:],[15,16,14,6],6)
    tube("Scabbard chape","gold",[(123,567,1135),(119,583,1130),sword[-1]],[16,15,6],6)
    tube("Sword grip","leather",sword[:3],[10,9,11],8)
    tube("Sword pommel","gold",[(185,370,1188),(180,387,1183)],[11,14],8)
    tube("Sword crossguard","gold",[(143,429,1165),(160,436,1168),(197,447,1171)],[9,11,8],6)
    # A convex kite shield, inset field, separate continuous rim and rear hand straps.
    outline=[(294,326),(394,280),(451,321),(448,426),(434,510),(415,566),(389,618),(377,618),(345,565),(320,502),(305,427)]
    center=np.array([381.,420.])
    def shield_point(x,y,bias):
        return (x,y,1247-.36*abs(x-381)-.08*abs(y-420)-.05*(x-381)+bias)
    rings=[]
    for scale,bias in [(1,-23),(1,0),(.96,6),(.83,6),(.80,1)]:
        rings.append([shield_point(*(center+(np.array(p)-center)*scale),bias) for p in outline])
    faces=[]
    for a,b in zip(rings,rings[1:]): faces+=strip_faces(a,b)
    part("Hammered gold shield rim","gold",faces)
    part("Painted kite shield", "shield",[(shield_point(381,420,9),p,rings[-1][(i+1)%len(outline)]) for i,p in enumerate(rings[-1])])
    part("Leather shield backing","leather",fan(rings[0]))
    # Bend the existing left vambrace and gauntlet onto the grip.
    angle=np.deg2rad(56)
    for name,_,faces in parts:
        if not ("Gauntlet" in name or "gauntlet" in name or name=="Vambrace"): continue
        if faces[0][:,0].mean()<248: continue
        for triangle in faces:
            dy=triangle[:,1].copy()-354
            dz=triangle[:,2].copy()-1106
            triangle[:,0]-=.29*dy
            triangle[:,1]=354+dy*np.cos(angle)-dz*np.sin(angle)
            triangle[:,2]=1106+dy*(np.sin(angle)-.22)+dz*np.cos(angle)
    block("Shield grip","leather",355,418,1194,32,56,26,5)
    for y in (382,443):
        tube("Shield hand strap","leather",[(339,y,1229),(349,y,1193),(367,y,1185),(392,y,1227)],6)
