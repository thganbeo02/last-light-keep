from .mesh import *

def build():
    for s in (-1,1):
        x=211+s*94
        loft("Leather boot", "leather",[(647,x-32,x+32,1015,1101),(692,x-35,x+33,1013,1099),(716,x-36,x+34,1012,1111),(728,x-54,x+48,1009,1150),(746,x-56,x+54,1008,1162),(762,x-57,x+58,1009,1164)])
        block("Block heel and outsole","leather",x,756,1085,120,35,161,3)
        block("Ankle strap","leather",x,693,1059,89,26,94,3)
        block("Boot tongue","leather",x,719,1090,67,24,70,4)
    loft("Robe bodice","plum",[(242,157,267,1018,1091),(282,126,305,985,1121),(344,118,309,974,1130),(411,147,286,985,1117),(457,143,291,980,1117)])
    # The inner tunic backs the channels between the outer robe folds.
    rings=[]
    for t in (0,.55,1):
        r=[]
        for j in range(32):
            a=2*pi*j/32
            r.append((211+sin(a)*(64+68*t),414+t*(260+16*cos(a*4)+8*sin(a*7)),1050+cos(a)*(55+33*t)-20*t))
        rings.append(r)
    solid("Inner robe and lower folds","plum",rings)
    # Each skirt panel has folded side returns, a broken edge, and a solid thickness.
    for i in range(16):
        ang=2*pi*i/16
        def hem_point(u,t,edge):
            a=ang+u*pi/16
            wave=cos(u*pi*.5)
            rx=64+(142-64)*t
            rz=54+(104-54)*t
            y=409+t*(edge-409)
            x=211+sin(a)*(rx+wave*(4+10*t))
            z=1050+cos(a)*(rz+wave*6)-(22*t if cos(a)<0 else 0)
            return (x,y,z)
        base=[707,666,673,641,676,645,651,675,707,668,641,671,659,615,656,674][i]
        us=[-1.08,-.81,-.58,-.56,-.21,-.18,.23,.26,.61,.64,1.06]
        cut=[-16,-16,-16,-3,-3,-23,-23,0,0,-12,-12]
        grid=[[hem_point(u,t,base+d) for u,d in zip(us,cut)] for t in (0,.3,.69,1)]
        cloth("Scorched skirt panel %02d"%(i+1),"plum",grid,4 if cos(ang)>0 else -4)
    cloth("Scorched shoulder stole","linen",[
        [(171,304,1113),(191,302,1127),(209,306,1124)],
        [(180,355,1131),(201,355,1136),(218,353,1135)],
        [(187,402,1133),(208,401,1137),(232,397,1134)],
        [(190,428,1133),(202,427,1137),(208,404,1135)]])
    for offset,tip in [(0,617),(48,671)]:
        nodes=[(-20,-4),(-13,-4),(-12,-14),(-6,-14),(-4,-2),(3,-2),(5,-10),(10,-10),(11,0),(20,0)]
        cloth("Ash-stained split stole","linen",[
            [(214+offset*.50+x*.78,415,1115+3*cos(x*.1)) for x,dy in nodes],
            [(215+offset*.70+x*.92,463,1135+3*cos(x*.1)) for x,dy in nodes],
            [(209+offset*.82+x*1.12,527,1145+4*cos(x*.1)) for x,dy in nodes],
            [(210+offset+x*1.19,tip+dy,1156+4*cos(x*.1)) for x,dy in nodes]])
    for ang in (pi*.71,pi*.93,pi*1.19):
        angles=[ang+d for d in (-.29,-.18,-.13,-.12,.02,.04,.18,.20,.30)]
        ends=[518,527,527,547,548,558,551,528,521]
        cloth("Hanging back mantle fold","plum",[
            [(211+sin(a)*(88+43*t),318+(end-318)*t,1050+cos(a)*(75+42*t)-12*t) for a,end in zip(angles,ends)]
            for t in (0,.45,1)],-5)
    for y in [392,412]:
        loft("Double leather belt","leather",[(y,146,291,982,1121),(y+3,143,293,980,1129),(y+12,144,292,980,1130),(y+16,148,290,982,1124)])
    for i in range(5):
        x=239+i*6
        loop("Square brass chain link","gold",x,421+i*19,1133+i*.8,23 if i%2==0 else 12,26,3.6)
    for side in (-1,1):
        if side==-1:
            loft("Scarred upper arm","skin",[(331,77,132,1015,1082),(352,68,129,1013,1087),(393,50,108,1020,1094),(425,45,103,1032,1106),(486,51,111,1052,1122)])
            for i in range(5):
                y=405+i*17
                x=77-i*.9
                zc=1064+i*5
                rings=[]
                for offset,w,d in [(0,67,63),(5,76,70),(20,73,68)]:
                    r=ring(y+offset,x-w/2,x+w/2,zc-d/2,zc+d/2)
                    rings.append([(xx,yy-(xx-x)*.25-(zz-zc)*.25,zz) for xx,yy,zz in r])
                solid("Overlapping linen binding","linen",rings)
            # Palm-inward fist: four curled fingers stacked front to back along the
            # bottom, and a raised thumb on the inner side.
            block("Resting fist","skin",78,497,1093,62,40,74,5)
            for i,z in enumerate((1122,1101,1080,1060)):
                block("Resting knuckle","skin",70+i,515+i,z,52,36,20,4)
            block("Resting thumb","skin",116,478,1118,28,42,28,5)
        else:
            loft("Bent sleeve","plum",[(306,298,350,1007,1077),(346,298,365,1006,1104),(384,300,365,1017,1121),(425,293,348,1037,1110),(441,298,323,1050,1102)])
            tube("Raised forearm","skin",[(326,403,1063),(339,387,1119),(354,354,1189)],[29,32,28])
            for i in range(3):
                tube("Raised wrist wrap","linen",[(334+i*4,389-i*8,1103+i*19),(339+i*4,382-i*8,1124+i*19)],[30,29])
            loft("Lantern hand","skin",[(311,347,380,1171,1210),(318,329,389,1162,1224),(335,317,405,1161,1230),(366,318,408,1165,1230),(384,325,387,1173,1221),(391,337,373,1182,1214)])
            for i in range(3):
                block("Gripping finger","skin",355+i*19,347+i*3,1221,22,52-i*4,23,4)
            tube("Gripping thumb","skin",[(327,345,1207),(327,365,1221),(346,379,1225)],[14,15,11])
    # Layered mantle encircles both shoulders. The cuts and front chevrons are modeled into each ring.
    for i,(top,rx,rz,thick) in enumerate([(296,184,102,64),(279,158,93,60),(255,136,83,67),(244,122,78,53)]):
        rings=[]
        for t in (0,.17,.80,1):
            r=[]
            for j in range(32):
                a=2*pi*j/32
                side=abs(sin(a))
                flare=side**3
                x=210+sin(a)*(rx-13+18*t)
                z=1043+cos(a)*(rz-15+19*t)
                y=top+t*thick+flare*(i==0)*41
                if cos(a)>.1:
                    y+=19*(1-side)+12*cos(3*a+.6)+7*sin(a)
                elif cos(a)<0:
                    y+=15*(1-side)+max(0,-cos(a))*(47 if i==0 else 20 if i==1 else 0)*t
                y+=((j%4 in [1,2])*5 if i<2 else 0)
                if i==0 and sin(a)>.5: y-=21*t
                r.append((x,y,z))
            rings.append(r)
        # Narrow bound edge changes direction at the edge of each wool layer.
        rings.insert(-1,[(x*.995+1.05,y-6,z+(1 if z>1043 else -1)) for x,y,z in rings[-1]])
        solid("Layered shoulder mantle %d"%(i+1),"plum",rings)
    disc("Mantle sun clasp","gold",169,283,1141,24,24)
    loft("Neck","skin",[(203,193,247,1057,1123),(256,188,249,1059,1125)])
    loft("Scarred face","skin",[(112,194,251,1026,1111),(138,180,266,1021,1133),(167,179,269,1019,1134),(196,178,268,1032,1133),(216,186,260,1040,1135),(227,202,248,1053,1136)])
    for s in (-1,1):
        b=[(185,151),(199,153),(216,158),(213,166),(197,164),(184,160)]
        plate("Angled brow","hair",[(x if s==-1 else 451-x,y,1136) for x,y in b],8)
    loft("Hooked nose","skin",[(157,219,231,1126,1138),(178,218,233,1128,1150),(188,217,236,1127,1153),(192,222,234,1128,1149)])
    loft("Short black beard","hair",[(193,187,260,1062,1128),(202,184,263,1059,1136),(218,189,259,1063,1143),(228,202,249,1076,1141)])
    plate("Moustache","hair",[(201,201,1140),(209,195,1141),(225,193,1143),(239,195,1141),(246,201,1139),(248,209,1138),(237,200,1142),(214,201,1143),(201,211,1138)],5)
    # Hollow hood: outer shell, raised binding, recessed inner wall and an open face.
    outer=[(180,81),(218,79),(253,81),(280,97),(289,111),(292,140),(304,151),(306,181),(326,214),(325,237),(304,252),(268,266),(224,278),(174,262),(131,249),(108,237),(109,216),(126,187),(130,151),(145,132),(147,108)]
    inner=[(188,104),(217,101),(248,104),(263,113),(270,125),(272,145),(280,157),(280,184),(295,208),(305,226),(292,235),(264,247),(225,256),(181,247),(149,237),(130,228),(141,210),(150,189),(153,165),(165,148),(166,122)]
    def lip_z(x,y):
        return 1117+10*abs((x-217)/105)-.12*(y-154)
    o=[(x,y,lip_z(x,y)-10) for x,y in outer]
    rim=[(x,y,lip_z(x,y)+4) for x,y in inner]
    deep=[(220+(x-220)*.88,y+2,1070) for x,y in inner]
    part("Gold-brown hood binding and lining","trim",strip_faces(o,rim))
    part("Hood lining","plum",strip_faces(rim,deep))
    rings=[o]
    for t,scale,dy,z in [(.28,1.02,0,1060),(.68,.98,-1,990),(1,.78,11,952)]:
        rings.append([(216+(x-216)*scale,151+(y-151)*scale+dy,z+(abs(x-216)/106)*12+(15 if y>250 else 0)) for x,y in outer])
    faces=fan(rings[-1])
    for a,b in zip(rings,rings[1:]): faces+=strip_faces(a,b)
    part("Faceted hood shell","plum",faces)
    loft("Hood nape fold","plum",[(178,147,284,962,1012),(200,123,301,955,1018),(216,112,318,952,1025),(236,120,310,954,1023),(250,149,287,967,1021),(267,185,254,975,1010)])
    for side in (-1,1):
        # Short seams round the temple into the back of the hood.
        tube("Hood seam","trim",[(216+side*x,y,z) for x,y,z in
             [(66,99,1080),(77,116,1051),(79,145,1017),(84,169,984)]],2.6,6)
    for s in (-1,1):
        for i in range(3):
            x=223+s*(20+i*12)
            block("Dark curled fringe","hair",x,124+i*14,1138-i*2,22,28,40,5)
        block("Hood-side curl","hair",223+s*46,176,1102,20,35,29,5)
    # Suspended lantern. The links pass through the hand and loop on the lid.
    loop("Forged lantern handle","dark",357,364,1204,40,60,5)
    loop("Hanger link","dark",375,404,1205,14,44,5)
    loop("Swivel eye","dark",375,430,1208,35,27,5,True)
    for name,rows in [
        ("Stepped chimney cap",[(435,351,399,1188,1230),(441,339,410,1175,1243),(456,336,412,1173,1246),(461,328,420,1167,1251),(471,324,426,1165,1253)]),
        ("Top iron rail",[(467,323,427,1164,1253),(473,317,431,1161,1258),(495,318,431,1161,1258),(501,327,422,1167,1251)]),
        ("Bottom iron rail",[(554,327,423,1168,1251),(558,318,432,1161,1258),(581,318,432,1161,1258),(585,325,425,1165,1253),(593,335,415,1174,1244)])]:
        loft(name,"dark",rows,cut=.25)
    for x in (331,418):
        for z in (1172,1247):
            block("Lantern cage upright","bronze",x,527,z,9,63,9,2)
    for y in (482,572):
        for x in (354,409):
            plate("Diamond cage rivet","gold",[(x-9,y,1262),(x,y-9,1262),(x+9,y,1262),(x,y+9,1262)],5)
        for z in (1184,1234):
            plate("Side cage rivet","gold",[(433,y,z-7),(433,y-7,z),(433,y,z+7),(433,y+7,z)],4,axis=0)
    # Inner glass panels transmit warm light but leave the coal visible through the cage.
    loft("Amber glass","glass",[(497,338,412,1177,1242),(558,338,412,1177,1242)],cut=.12)
    loft("Firelit inner chimney","amber",[(499,345,405,1180,1220),(553,344,406,1179,1220)],cut=.24)
    solid("Glowing coal","coal",[
        [(377+cos(j*pi/4)*r,y+sin(j*1.7)*3,1212+sin(j*pi/4)*r*.82) for j in range(8)]
        for y,r in [(506,9),(514,22),(534,30),(550,24),(557,15)]])
